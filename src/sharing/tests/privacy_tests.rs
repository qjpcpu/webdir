use super::{body, Server};
use crate::sharing::{sign, Scope};
use std::fs;
use std::path::Path;

const OWNER: &str = "webdir_auth_token=secret";
const PRIVATE: &str = "PRIVATE-CONTENT-7e924ab1";

fn assert_status(response: &[u8], status: u16, context: &str) {
    assert!(
        response.starts_with(format!("HTTP/1.1 {status} ").as_bytes()),
        "{context}: {}",
        String::from_utf8_lossy(response)
    );
}

fn response_body(response: &[u8]) -> &[u8] {
    let offset = response
        .windows(4)
        .position(|part| part == b"\r\n\r\n")
        .unwrap();
    &response[offset + 4..]
}

fn assert_denied(response: &[u8], method: &str, context: &str) {
    assert_status(response, 403, context);
    let response = String::from_utf8_lossy(response);
    assert!(
        !response.contains(PRIVATE),
        "{context}: leaked private content"
    );
    for header in ["ETag:", "Content-Range:", "Location:", "Set-Cookie:"] {
        assert!(!response.contains(header), "{context}: {header}");
    }
    if method == "HEAD" {
        assert!(response_body(response.as_bytes()).is_empty(), "{context}");
    }
}

#[test]
fn every_file_representation_enforces_scope_for_cookies_and_share_urls() {
    let server = Server::new();
    let (url, cookie) = server.share();
    let share_query = url.split_once('?').unwrap().1;
    // Include every rendering branch plus opaque downloads and adjacent metadata.
    for name in [
        "private.md",
        "private.txt",
        "private.rs",
        "private.html",
        "private.htm",
        "private.drawio",
        "private.svg",
        "private.png",
        "private.jpg",
        "private.jpeg",
        "private.gif",
        "private.webp",
        "private.mp4",
        "private.pdf",
        "private.docx",
        "private.xlsx",
        "private.pptx",
        "private.bin",
        "private.unknown",
        "private.md.review.json",
        "gallery-comments.json",
        "隐私 文档.txt",
    ] {
        fs::write(server.root().join("docs/project2").join(name), PRIVATE).unwrap();
        fs::write(
            server.root().join("docs/project").join(name),
            "shared content",
        )
        .unwrap();
        let encoded = crate::percent_encode_component(name);
        let inside = format!("/docs/project/{encoded}?mode=raw");
        let allowed = server.request("GET", &inside, &cookie, "");
        assert_eq!(body(&allowed), "shared content");
        let outside = format!("/docs/project2/{encoded}");
        let owner = server.request("GET", &format!("{outside}?mode=raw"), OWNER, "");
        assert_eq!(body(&owner), PRIVATE);
        for mode in [
            "",
            "mode=raw",
            "mode=asset",
            "mode=thumb",
            "mode=gallery-thumb",
            "mode=gallery-preview",
        ] {
            let target = format!("{outside}?{mode}");
            for method in ["GET", "HEAD"] {
                for accept in ["text/html", "*/*"] {
                    for (target, cookie) in [
                        (target.clone(), cookie.as_str()),
                        (format!("{target}&{share_query}"), ""),
                    ] {
                        let response = server.request_bytes(
                            method,
                            &target,
                            cookie,
                            "",
                            &[("Accept", accept)],
                            "secret",
                        );
                        assert_denied(&response, method, &target);
                    }
                }
            }
        }
    }
}

#[test]
fn directory_views_search_and_metadata_endpoints_reject_outside_targets() {
    let server = Server::new();
    let (url, cookie) = server.share();
    let share_query = url.split_once('?').unwrap().1;
    fs::write(server.root().join("docs/project2/private.md"), PRIVATE).unwrap();
    fs::write(server.root().join("docs/project2/private.svg"), "<svg/>").unwrap();
    for target in [
        "/",
        "/docs/",
        "/docs/project2",
        "/docs/project2/",
        "/docs/missing/",
        "/docs/project2/?view=gallery",
        "/docs/project2/?mode=similarity-order",
        "/docs/project2/?mode=directory-entries",
        "/docs/project2/?mode=file-search&q=private",
        "/docs/project2/?mode=file-search&scope=root&q=private",
        "/?mode=file-search&scope=root&q=private",
        "/docs/project2/private.md?mode=file-search&q=private",
        "/docs/project2/private.md?mode=review-data",
        "/docs/project2/private.svg?mode=gallery-comments",
    ] {
        for method in ["GET", "HEAD"] {
            let separator = if target.contains('?') { '&' } else { '?' };
            for (target, cookie) in [
                (target.to_owned(), cookie.as_str()),
                (format!("{target}{separator}{share_query}"), ""),
            ] {
                let response = server.request_bytes(method, &target, cookie, "", &[], "secret");
                assert_denied(&response, method, &target);
            }
        }
    }
}

#[test]
fn encoded_and_normalized_paths_preserve_the_directory_boundary() {
    let server = Server::new();
    let (url, cookie) = server.share();
    let share_query = url.split_once('?').unwrap().1;
    fs::write(server.root().join("docs/project2/private.md"), PRIVATE).unwrap();
    for path in [
        "/docs/project/../project2/private.md",
        "/docs/project/%2e%2e/project2/private.md",
        "/docs/project/%2E%2E%2Fproject2%2Fprivate.md",
        "/docs/project/.%2e/project2/private.md",
        "/docs/project/%2e./project2/private.md",
        "/docs/project/sub/../../project2/private.md",
        "/docs/project//..//project2/private.md",
        "/docs/project%32/private.md",
        "//docs//project2//private.md",
        "/docs/project/./../project2/private.md",
    ] {
        for method in ["GET", "HEAD"] {
            for (target, cookie) in [
                (format!("{path}?mode=raw"), cookie.as_str()),
                (format!("{path}?mode=raw&{share_query}"), ""),
            ] {
                assert_denied(
                    &server.request_bytes(method, &target, cookie, "", &[], "secret"),
                    method,
                    &target,
                );
            }
        }
    }
    for path in ["/docs//project/./note.md", "/docs/%70roject/note.md"] {
        let response = server.request("GET", &format!("{path}?mode=raw"), &cookie, "");
        assert_eq!(body(&response), "# Original\n");
    }
    for path in [
        "/docs/project/%252e%252e/project2/private.md",
        "/docs/project/%2e%2e%5cproject2%5cprivate.md",
    ] {
        let response = server.request("GET", &format!("{path}?mode=raw"), &cookie, "");
        assert_status(response.as_bytes(), 404, path);
        assert!(!response.contains(PRIVATE));
    }
}

#[test]
fn warm_image_caches_and_conditional_requests_cannot_bypass_scope() {
    let mut server = Server::new();
    let cache = tempfile::tempdir().unwrap();
    server.image_cache = Some(crate::ImageCache::new(cache.path()).unwrap());
    let (_, cookie) = server.share();
    for directory in ["docs/project", "docs/project2"] {
        image::RgbImage::from_pixel(16, 16, image::Rgb([17, 31, 47]))
            .save(server.root().join(directory).join("photo.png"))
            .unwrap();
    }
    for mode in ["asset", "thumb", "gallery-thumb", "gallery-preview"] {
        for directory in ["docs/project", "docs/project2"] {
            let path = server.root().join(directory).join("photo.png");
            let version = crate::file_version(&fs::metadata(path).unwrap());
            let target = format!("/{directory}/photo.png?mode={mode}&v={version}");
            let owner = server.request_bytes("GET", &target, OWNER, "", &[], "secret");
            assert_status(&owner, 200, &target);
            assert!(image::load_from_memory(response_body(&owner)).is_ok());
            let headers = String::from_utf8_lossy(&owner);
            let etag = headers
                .lines()
                .find_map(|line| line.strip_prefix("ETag: "))
                .unwrap();
            assert!(headers.contains("immutable"));
            for method in ["GET", "HEAD"] {
                for extra in [vec![], vec![("If-None-Match", etag)]] {
                    let response =
                        server.request_bytes(method, &target, &cookie, "", &extra, "secret");
                    if directory == "docs/project2" {
                        assert_denied(&response, method, &target);
                    } else {
                        assert_status(&response, if extra.is_empty() { 200 } else { 304 }, &target);
                        if method == "HEAD" || !extra.is_empty() {
                            assert!(response_body(&response).is_empty());
                        } else {
                            assert_eq!(response_body(&response), response_body(&owner));
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn video_range_requests_enforce_scope_before_returning_bytes_or_size() {
    let server = Server::new();
    let (_, cookie) = server.share();
    for directory in ["docs/project", "docs/project2"] {
        fs::write(server.root().join(directory).join("video.mp4"), PRIVATE).unwrap();
    }
    for mode in ["", "?mode=asset"] {
        for range in ["bytes=0-6", "bytes=-4", "bytes=8-", "bytes=99999-"] {
            for method in ["GET", "HEAD"] {
                let headers = [("Accept", "*/*"), ("Range", range)];
                let target = format!("/docs/project2/video.mp4{mode}");
                assert_denied(
                    &server.request_bytes(method, &target, &cookie, "", &headers, "secret"),
                    method,
                    &target,
                );
                let target = format!("/docs/project/video.mp4{mode}");
                let response =
                    server.request_bytes(method, &target, &cookie, "", &headers, "secret");
                assert_status(
                    &response,
                    if range == "bytes=99999-" { 416 } else { 206 },
                    &target,
                );
                if method == "HEAD" {
                    assert!(response_body(&response).is_empty());
                } else if range == "bytes=0-6" {
                    assert_eq!(response_body(&response), b"PRIVATE");
                }
            }
        }
    }
}

#[test]
fn websocket_upgrades_cannot_open_outside_documents() {
    let server = Server::new();
    let (_, cookie) = server.share();
    for mode in ["collab", "review-collab"] {
        let target = format!("/docs/project2/private.md?mode={mode}");
        let response = server.request_bytes(
            "GET",
            &target,
            &cookie,
            "",
            &[
                ("Connection", "Upgrade"),
                ("Upgrade", "websocket"),
                ("Sec-WebSocket-Version", "13"),
                ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ],
            "secret",
        );
        assert_denied(&response, "GET", &target);
    }
}

#[test]
fn root_search_from_removed_directories_preserves_share_scope() {
    let server = Server::new();
    let (_, cookie) = server.share();
    let removed = server.root().join("docs/project/removed");
    fs::create_dir(&removed).unwrap();
    fs::remove_dir(&removed).unwrap();
    let outside = server.root().join("docs/project2/private.md");
    for (query, expected) in [
        ("note".to_owned(), vec!["/docs/project/note.md"]),
        (
            "sub/child.md".to_owned(),
            vec!["/docs/project/sub/child.md"],
        ),
        ("private".to_owned(), vec![]),
        ("xxx/project2/private.md".to_owned(), vec![]),
        (outside.to_string_lossy().into_owned(), vec![]),
    ] {
        let query = crate::percent_encode_component(&query);
        let target = format!("/docs/project/removed/?mode=file-search&scope=root&q={query}");
        let response = server.request("GET", &target, &cookie, "");
        assert_status(response.as_bytes(), 200, &target);
        let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
        assert_eq!(json["scope"], "tree");
        let hrefs: Vec<_> = json["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|result| result["open_href"].as_str().unwrap())
            .collect();
        assert_eq!(hrefs, expected, "{target}: {json}");
    }
    let response = server.request(
        "GET",
        "/docs/project/removed/?mode=file-search&scope=root&q=private",
        OWNER,
        "",
    );
    assert_status(response.as_bytes(), 200, "owner root search");
    let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
    assert_eq!(json["results"][0]["open_href"], "/docs/project2/private.md");
    let response = server.request(
        "GET",
        "/docs/project2/removed/?mode=file-search&scope=root&q=note",
        &cookie,
        "",
    );
    assert_status(response.as_bytes(), 403, "outside share scope");
}

#[test]
fn root_and_path_search_return_only_shared_files_and_image_links() {
    let server = Server::new();
    let (_, cookie) = server.share();
    for directory in ["docs/project", "docs/project/sub", "docs/project2"] {
        for name in ["privacy-match.txt", "privacy-match.svg"] {
            fs::write(server.root().join(directory).join(name), "search fixture").unwrap();
        }
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        server.root().join("docs/project2"),
        server.root().join("docs/project/sub/private-link"),
    )
    .unwrap();
    // Require a working fd/fdfind so an empty fallback cannot pass isolation tests.
    for (endpoint, scope, expected) in [
        ("/docs/project/sub/", "", 2),
        ("/docs/project/sub/child.md", "", 2),
        ("/docs/project/sub/", "&scope=root", 4),
        ("/docs/project/sub/child.md", "&scope=root", 4),
    ] {
        let target = format!("{endpoint}?mode=file-search&q=privacy-match{scope}");
        let response = server.request("GET", &target, &cookie, "");
        assert_status(response.as_bytes(), 200, &target);
        let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
        assert_eq!(
            json["scope"], "tree",
            "install fd/fdfind to exercise recursive search"
        );
        let results = json["results"].as_array().unwrap();
        assert_eq!(results.len(), expected, "{target}: {json}");
        for result in results {
            let href = result["open_href"].as_str().unwrap();
            assert!(href.starts_with("/docs/project/"));
            assert!(!href.contains("private-link"));
            assert_status(
                server.request("GET", href, &cookie, "").as_bytes(),
                200,
                href,
            );
            if let Some(thumbnail) = result["thumbnail_href"].as_str() {
                assert!(thumbnail.starts_with("/docs/project/"));
                assert_status(
                    server.request("GET", thumbnail, &cookie, "").as_bytes(),
                    200,
                    thumbnail,
                );
            }
        }
    }
    let inside = server.root().join("docs/project/sub/privacy-match.txt");
    let outside = server.root().join("docs/project2/privacy-match.txt");
    let linked = server
        .root()
        .join("docs/project/sub/private-link/privacy-match.txt");
    for (query, count) in [
        (inside.to_string_lossy().into_owned(), 1),
        (outside.to_string_lossy().into_owned(), 0),
        (linked.to_string_lossy().into_owned(), 0),
        ("sub/privacy-match.txt".into(), 1),
        ("xxx/sub/privacy-match.txt".into(), 2),
    ] {
        let query = crate::percent_encode_component(&query);
        let target = format!("/docs/project/sub/?mode=file-search&scope=root&q={query}");
        let response = server.request("GET", &target, &cookie, "");
        assert_status(response.as_bytes(), 200, &target);
        let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
        let results = json["results"].as_array().unwrap();
        assert_eq!(results.len(), count, "{target}: {json}");
        for result in results {
            assert!(result["open_href"]
                .as_str()
                .unwrap()
                .starts_with("/docs/project/"));
            assert!(!result["open_href"]
                .as_str()
                .unwrap()
                .contains("private-link"));
        }
    }
    let query = crate::percent_encode_component(
        &server
            .root()
            .join("docs/project2/privacy-mat")
            .to_string_lossy(),
    );
    let response = server.request(
        "GET",
        &format!("/docs/project/?mode=file-search&q={query}"),
        &cookie,
        "",
    );
    let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
    assert_eq!(json["results"], serde_json::json!([]));
}

#[cfg(unix)]
#[test]
fn symlink_chains_and_external_directories_are_filtered_at_every_read_entry() {
    use std::os::unix::fs::symlink;
    let server = Server::new();
    let external = tempfile::tempdir().unwrap();
    let (_, cookie) = server.share();
    fs::write(external.path().join("private.md"), PRIVATE).unwrap();
    image::RgbImage::new(8, 8)
        .save(external.path().join("private.png"))
        .unwrap();
    symlink(external.path(), server.root().join("docs/project/external")).unwrap();
    symlink("external", server.root().join("docs/project/chain")).unwrap();
    symlink(
        external.path().join("private.png"),
        server.root().join("docs/project/leak.png"),
    )
    .unwrap();
    symlink("sub", server.root().join("docs/project/inside")).unwrap();
    for target in [
        "/docs/project/external/",
        "/docs/project/chain/?view=gallery",
        "/docs/project/chain/?mode=directory-entries",
        "/docs/project/external/?mode=similarity-order",
        "/docs/project/external/?mode=file-search&scope=root&q=private",
        "/docs/project/chain/private.md?mode=raw",
    ] {
        assert_denied(
            server.request("GET", target, &cookie, "").as_bytes(),
            "GET",
            target,
        );
    }
    for path in ["/docs/project/leak.png", "/docs/project/chain/private.png"] {
        for mode in ["raw", "asset", "thumb", "gallery-thumb", "gallery-preview"] {
            let target = format!("{path}?mode={mode}");
            for method in ["GET", "HEAD"] {
                assert_denied(
                    server.request(method, &target, &cookie, "").as_bytes(),
                    method,
                    &target,
                );
            }
        }
    }
    for query in [
        "",
        "?view=gallery",
        "?mode=similarity-order",
        "?mode=directory-entries",
        "?mode=file-search&scope=root&q=private",
    ] {
        let response = server.request("GET", &format!("/docs/project/{query}"), &cookie, "");
        assert_status(response.as_bytes(), 200, query);
        for name in [
            "leak.png",
            "private.png",
            "private.md",
            "href=\"/docs/project/external/\"",
            "href=\"/docs/project/chain/\"",
        ] {
            assert!(!body(&response).contains(name), "{query}: {name}");
        }
    }
    let response = server.request("GET", "/docs/project/inside/child.md?mode=raw", &cookie, "");
    assert_eq!(body(&response), "# Original\n");
    symlink(
        server.root().join("docs/project"),
        server.root().join("alias"),
    )
    .unwrap();
    assert_denied(
        server
            .request("GET", "/alias/note.md", &cookie, "")
            .as_bytes(),
        "GET",
        "/alias/note.md",
    );
}

#[test]
fn scope_checks_existing_and_new_targets_at_component_boundaries() {
    let server = Server::new();
    let token = sign(Path::new("docs/project"), "secret").unwrap();
    let scope = Scope::verify(&token, "secret", &server.root()).unwrap();
    for (relative, allowed) in [
        ("docs/project", true),
        ("docs/project/sub/child.md", true),
        ("docs/project/new/nested/comments.json", true),
        ("docs", false),
        ("docs/project2/private.md", false),
        ("docs/project2/new/nested/comments.json", false),
    ] {
        assert_eq!(
            scope.allows_request(&server.root(), Path::new(relative)),
            allowed,
            "{relative}"
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        for (target, name) in [
            ("../project2", "outside"),
            ("sub", "inside"),
            ("missing-target", "dangling"),
            ("loop", "loop"),
        ] {
            symlink(target, server.root().join("docs/project").join(name)).unwrap();
        }
        for (relative, allowed) in [
            ("docs/project/outside/new/comments.json", false),
            ("docs/project/inside/new/comments.json", true),
            ("docs/project/dangling", false),
            ("docs/project/loop", false),
        ] {
            assert_eq!(
                scope.allows_request(&server.root(), Path::new(relative)),
                allowed,
                "{relative}"
            );
        }
    }
}

#[test]
fn outside_mutation_endpoints_preserve_files_comments_and_marks() {
    let server = Server::new();
    let (_, cookie) = server.share();
    let directory = server.root().join("docs/project2");
    let image = directory.join("private.svg");
    fs::write(&image, PRIVATE).unwrap();
    fs::write(directory.join("private.md"), PRIVATE).unwrap();
    let review = serde_json::json!({"comments":[], "private":PRIVATE}).to_string();
    fs::write(directory.join("private.md.review.json"), &review).unwrap();
    let comments = serde_json::json!({"comments":[], "instructions":[PRIVATE]}).to_string();
    fs::write(directory.join("gallery-comments.json"), &comments).unwrap();
    server.state.set_favourite(&image, true).unwrap();
    server.state.set_image_tag(&image, Some(3)).unwrap();
    server
        .state
        .set_directory_favourite(&directory, true)
        .unwrap();
    server
        .state
        .set_directory_favourite_label(&directory, "Private folder")
        .unwrap();
    for (method, target, payload) in [
        ("PUT", "/docs/project2/private.md?mode=raw", "overwritten"),
        (
            "POST",
            "/docs/project2/private.md?mode=preview",
            "# Preview",
        ),
        (
            "POST",
            "/docs/project2/private.md?mode=review-action",
            r#"{"type":"add-comment","comment":{"id":"new","scope":"document","status":"open","messages":[]}}"#,
        ),
        (
            "POST",
            "/docs/project2/private.svg?mode=gallery-comments",
            r#"{"type":"delete-all"}"#,
        ),
        ("DELETE", "/docs/project2/private.svg", ""),
        ("PUT", "/docs/project2/private.svg?mode=favourite", ""),
        ("DELETE", "/docs/project2/private.svg?mode=favourite", ""),
        (
            "PUT",
            "/docs/project2/private.svg?mode=image-tag",
            r#"{"tag":1}"#,
        ),
        ("DELETE", "/docs/project2/private.svg?mode=image-tag", ""),
        ("PUT", "/docs/project2/?mode=directory-favourite", ""),
        ("DELETE", "/docs/project2/?mode=directory-favourite", ""),
        (
            "POST",
            "/docs/project2/?mode=directory-favourite-label",
            r#""changed""#,
        ),
        (
            "POST",
            "/docs/project2/?mode=directory-favourite-order",
            r#"["/docs/project2/"]"#,
        ),
        (
            "POST",
            "/docs/project2/?mode=batch-images",
            r#"{"action":"delete","files":["private.svg"]}"#,
        ),
        (
            "POST",
            "/docs/project2/?mode=batch-images",
            r#"{"action":"move","files":["private.svg"],"directory":"moved"}"#,
        ),
        (
            "POST",
            "/docs/project2/?mode=batch-images",
            r#"{"action":"clear-mark","files":["private.svg"],"filter":"all"}"#,
        ),
        ("POST", "/docs/project2/?mode=share", ""),
    ] {
        let response = server.request(method, target, &cookie, payload);
        assert_denied(response.as_bytes(), method, target);
    }
    assert_eq!(fs::read_to_string(&image).unwrap(), PRIVATE);
    assert_eq!(
        fs::read_to_string(directory.join("private.md")).unwrap(),
        PRIVATE
    );
    assert_eq!(
        fs::read_to_string(directory.join("private.md.review.json")).unwrap(),
        review
    );
    assert_eq!(
        fs::read_to_string(directory.join("gallery-comments.json")).unwrap(),
        comments
    );
    assert!(server.state.is_favourite(&image).unwrap());
    assert_eq!(server.state.image_tag(&image).unwrap(), Some(3));
    assert!(server.state.is_directory_favourite(&directory).unwrap());
    assert_eq!(
        server
            .state
            .directory_favourite_label(&directory)
            .unwrap()
            .as_deref(),
        Some("Private folder")
    );
    assert!(!directory.join("moved").exists());
}

#[cfg(unix)]
#[test]
fn linked_sidecars_and_batch_sources_and_destinations_preserve_private_data() {
    use std::os::unix::fs::symlink;
    let server = Server::new();
    let (_, cookie) = server.share();
    let shared = server.root().join("docs/project");
    let private = server.root().join("docs/project2");
    let secret_sidecar = private.join("comments.json");
    fs::write(&secret_sidecar, PRIVATE).unwrap();
    symlink(&secret_sidecar, shared.join("note.md.review.json")).unwrap();
    symlink(&secret_sidecar, shared.join("gallery-comments.json")).unwrap();
    for path in ["note.md.review.json", "gallery-comments.json"] {
        let target = format!("/docs/project/{path}?mode=raw");
        assert_denied(
            server.request("GET", &target, &cookie, "").as_bytes(),
            "GET",
            &target,
        );
    }
    let response = server.request(
        "POST",
        "/docs/project/%E7%8C%AB.svg?mode=gallery-comments",
        &cookie,
        r#"{"type":"delete-all"}"#,
    );
    assert_denied(response.as_bytes(), "POST", "linked gallery comments");
    for mode in ["review-data", "review-collab"] {
        let target = format!("/docs/project/note.md?mode={mode}");
        assert_denied(
            server.request("HEAD", &target, &cookie, "").as_bytes(),
            "HEAD",
            &target,
        );
    }
    for action in [
        serde_json::json!({"action":"delete", "files":["猫.svg"]}),
        serde_json::json!({"action":"move", "files":["猫.svg"], "directory":"sub"}),
    ] {
        let response = server.request(
            "POST",
            "/docs/project/?mode=batch-images",
            &cookie,
            &action.to_string(),
        );
        let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
        assert_eq!(json["affected"], 0);
        assert_eq!(json["errors"].as_array().unwrap().len(), 1);
        assert!(shared.join("猫.svg").is_file());
        assert_eq!(fs::read_to_string(&secret_sidecar).unwrap(), PRIVATE);
    }
    fs::remove_file(shared.join("gallery-comments.json")).unwrap();
    symlink(&secret_sidecar, shared.join("sub/gallery-comments.json")).unwrap();
    let response = server.request(
        "POST",
        "/docs/project/?mode=batch-images",
        &cookie,
        r#"{"action":"move","files":["猫.svg"],"directory":"sub"}"#,
    );
    let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
    assert_eq!(json["affected"], 0);
    assert!(shared.join("猫.svg").is_file());
    assert!(!shared.join("sub/猫.svg").exists());
    fs::write(private.join("private.svg"), PRIVATE).unwrap();
    symlink(private.join("private.svg"), shared.join("linked.svg")).unwrap();
    server
        .state
        .set_favourite(&private.join("private.svg"), true)
        .unwrap();
    server
        .state
        .set_image_tag(&private.join("private.svg"), Some(4))
        .unwrap();
    for action in [
        serde_json::json!({"action":"delete", "files":["linked.svg"]}),
        serde_json::json!({"action":"move", "files":["linked.svg"], "directory":"new-folder"}),
        serde_json::json!({"action":"clear-mark", "files":["linked.svg"], "filter":"all"}),
        serde_json::json!({"action":"delete", "files":["../project2/private.svg"]}),
    ] {
        let response = server.request(
            "POST",
            "/docs/project/?mode=batch-images",
            &cookie,
            &action.to_string(),
        );
        let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
        assert_eq!(json["affected"], 0, "{action}: {json}");
        assert_eq!(json["errors"].as_array().unwrap().len(), 1);
    }
    assert_eq!(
        fs::read_to_string(private.join("private.svg")).unwrap(),
        PRIVATE
    );
    assert_eq!(fs::read_to_string(&secret_sidecar).unwrap(), PRIVATE);
    assert!(server
        .state
        .is_favourite(&private.join("private.svg"))
        .unwrap());
    assert_eq!(
        server
            .state
            .image_tag(&private.join("private.svg"))
            .unwrap(),
        Some(4)
    );
    assert!(!shared.join("new-folder").exists());
}

#[test]
fn invalid_or_forged_share_credentials_never_grant_access() {
    let server = Server::new();
    let token = sign(Path::new("docs/project"), "secret").unwrap();
    let root_token = sign(Path::new(""), "secret").unwrap();
    let parts: Vec<_> = token.split('.').collect();
    let forged = format!(
        "{}.{}.{}",
        parts[0],
        root_token.split('.').nth(1).unwrap(),
        parts[2]
    );
    for token in [
        "invalid".to_owned(),
        forged,
        sign(Path::new("docs/project"), "wrong-secret").unwrap(),
        sign(Path::new("docs/missing"), "secret").unwrap(),
        sign(Path::new("docs/project/note.md"), "secret").unwrap(),
    ] {
        for target in [
            "/docs/project/note.md?mode=raw",
            "/docs/project2/private.md?mode=raw",
        ] {
            for (target, cookie) in [
                (format!("{target}&share={token}"), String::new()),
                (target.to_owned(), format!("webdir_share={token}")),
            ] {
                assert_denied(
                    server.request("GET", &target, &cookie, "").as_bytes(),
                    "GET",
                    &target,
                );
            }
        }
    }
    let (_, cookie) = server.share();
    let target = "/docs/project2/private.md?mode=raw";
    assert_denied(
        server
            .request(
                "GET",
                target,
                &format!("webdir_auth_token=stale; {cookie}"),
                "",
            )
            .as_bytes(),
        "GET",
        target,
    );
    let response = server.request("GET", target, "", "");
    assert_status(response.as_bytes(), 401, target);
}

#[test]
fn shared_static_assets_do_not_expose_root_files() {
    let server = Server::new();
    let (_, cookie) = server.share();
    for path in [
        "/favicon.svg",
        "/favicon.ico",
        crate::DRAWIO_VIEWER_PATH,
        crate::MERMAID_PATH,
        crate::YJS_PATH,
    ] {
        let disk_path = server.root().join(path.trim_start_matches('/'));
        fs::create_dir_all(disk_path.parent().unwrap()).unwrap();
        fs::write(disk_path, PRIVATE).unwrap();
        for method in ["GET", "HEAD"] {
            let response = server.request_bytes(method, path, &cookie, "", &[], "secret");
            assert_status(&response, 200, path);
            assert!(!String::from_utf8_lossy(&response).contains(PRIVATE));
            if method == "HEAD" {
                assert!(response_body(&response).is_empty());
            } else {
                assert!(!response_body(&response).is_empty());
            }
        }
    }
}
