use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

pub(crate) const COOKIE_NAME: &str = "webdir_share";
pub(crate) const SCRIPT: &str = include_str!("../assets/sharing.js");

pub(crate) fn denied_page(share_url: &str) -> String {
    include_str!("../assets/share-denied.html")
        .replace("{{share_url}}", &super::escape_html(share_url))
}

#[derive(Clone, Serialize, Deserialize)]
struct Claims {
    scope: String,
}

pub(crate) fn sign(relative: &Path, secret: &str) -> io::Result<String> {
    encode(
        &Header::new(Algorithm::HS256),
        &Claims {
            scope: super::url_for_path(relative, true),
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(io::Error::other)
}

#[derive(Debug)]
pub(crate) struct Scope {
    pub(crate) relative: PathBuf,
    pub(crate) canonical: PathBuf,
}

impl Scope {
    pub(crate) fn verify(token: &str, secret: &str, root: &Path) -> Option<Self> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.required_spec_claims.clear();
        validation.validate_exp = false;
        let claims = decode::<Claims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )
        .ok()?
        .claims;
        let relative = super::safe_relative_path(&super::percent_decode(&claims.scope)?)?;
        let canonical = fs::canonicalize(root.join(&relative)).ok()?;
        canonical.is_dir().then_some(Self {
            relative,
            canonical,
        })
    }

    pub(crate) fn allows(&self, path: &Path) -> bool {
        resolved_target(path).is_ok_and(|target| target.starts_with(&self.canonical))
    }

    pub(crate) fn allows_request(&self, root: &Path, relative: &Path) -> bool {
        relative.starts_with(&self.relative) && self.allows(&root.join(relative))
    }
}

// Writes may create a sidecar or a destination folder that does not exist yet.
fn resolved_target(path: &Path) -> io::Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(_) => fs::canonicalize(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or(error)?;
            let name = path
                .file_name()
                .ok_or_else(|| io::Error::other("无效的目标路径"))?;
            Ok(resolved_target(parent)?.join(name))
        }
        Err(error) => Err(error),
    }
}

#[derive(Default)]
pub(crate) struct Access {
    pub(crate) can_share: bool,
    pub(crate) scope: Option<Scope>,
}

impl Access {
    pub(crate) fn not_found(&self, request_path: &str) -> String {
        let body = super::render_not_found_page(request_path);
        match &self.scope {
            Some(scope) => body.replace(
                "href=\"/\">浏览根目录",
                &format!(
                    "href=\"{}\">浏览分享目录",
                    super::url_for_path(&scope.relative, true)
                ),
            ),
            None => body,
        }
    }

    pub(crate) fn allows(&self, path: &Path) -> bool {
        self.scope.as_ref().is_none_or(|scope| scope.allows(path))
    }

    pub(crate) fn allows_request(&self, root: &Path, relative: &Path) -> bool {
        self.scope
            .as_ref()
            .is_none_or(|scope| scope.allows_request(root, relative))
    }

    pub(crate) fn page(&self, body: String) -> String {
        if self.can_share {
            body.replacen("</body>", &format!("<script>{SCRIPT}</script></body>"), 1)
        } else {
            body
        }
    }
}

#[cfg(test)]
mod tests {
    mod privacy_tests;

    use super::*;
    use crate::{CollaborationHub, ReviewHub, StateStore};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    struct Server {
        directory: tempfile::TempDir,
        state: StateStore,
        image_cache: Option<crate::ImageCache>,
    }

    impl Server {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            fs::create_dir_all(directory.path().join("docs/project/sub")).unwrap();
            fs::create_dir_all(directory.path().join("docs/project2")).unwrap();
            for path in [
                "docs/project/note.md",
                "docs/project/sub/child.md",
                "docs/project2/private.md",
            ] {
                fs::write(directory.path().join(path), "# Original\n").unwrap();
            }
            fs::write(
                directory.path().join("docs/project/猫.svg"),
                "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            )
            .unwrap();
            Self {
                directory,
                state: StateStore::new(None).unwrap(),
                image_cache: None,
            }
        }

        fn root(&self) -> PathBuf {
            fs::canonicalize(self.directory.path()).unwrap()
        }

        fn request(&self, method: &str, target: &str, cookie: &str, body: &str) -> String {
            self.request_with_secret(method, target, cookie, body, "secret")
        }

        fn request_with_secret(
            &self,
            method: &str,
            target: &str,
            cookie: &str,
            body: &str,
            secret: &str,
        ) -> String {
            String::from_utf8(self.request_bytes(method, target, cookie, body, &[], secret))
                .unwrap()
        }

        fn request_bytes(
            &self,
            method: &str,
            target: &str,
            cookie: &str,
            body: &str,
            headers: &[(&str, &str)],
            secret: &str,
        ) -> Vec<u8> {
            let root = self.root();
            let state = self.state.clone();
            let image_cache = self.image_cache.clone();
            let secret = secret.to_owned();
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                crate::handle_connection_with_auth(
                    stream,
                    &root,
                    &CollaborationHub::default(),
                    &ReviewHub::default(),
                    false,
                    image_cache.as_ref(),
                    &state,
                    Some(&secret),
                )
                .unwrap();
            });
            let mut client = TcpStream::connect(address).unwrap();
            client
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let headers = headers
                .iter()
                .map(|(name, value)| format!("{name}: {value}\r\n"))
                .collect::<String>();
            let request = format!("{method} {target} HTTP/1.1\r\nHost: localhost\r\nAccept: text/html\r\nCookie: {cookie}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len());
            client.write_all(request.as_bytes()).unwrap();
            let mut response = Vec::new();
            client.read_to_end(&mut response).unwrap();
            server.join().unwrap();
            response
        }

        fn share(&self) -> (String, String) {
            let response = self.request(
                "POST",
                "/docs/project/note.md?mode=share",
                "webdir_auth_token=secret",
                "",
            );
            assert!(response.starts_with("HTTP/1.1 200"), "{response}");
            let json: serde_json::Value = serde_json::from_str(body(&response)).unwrap();
            let url = json["url"].as_str().unwrap().to_owned();
            let token = crate::query_parameter(url.split_once('?').unwrap().1, "share").unwrap();
            (url, format!("{COOKIE_NAME}={token}"))
        }
    }

    fn body(response: &str) -> &str {
        response.split_once("\r\n\r\n").unwrap().1
    }

    #[test]
    fn denied_page_returns_to_the_shared_directory() {
        let server = Server::new();
        let (url, cookie) = server.share();
        let response = server.request("GET", "/docs/", &cookie, "");
        assert!(response.starts_with("HTTP/1.1 403"));
        assert!(response.contains("Content-Type: text/html; charset=utf-8"));
        assert!(body(&response).contains("超出分享范围"));
        assert!(body(&response).contains("href=\"/docs/project/\""));
        assert!(server
            .request("GET", "/docs/project/", &cookie, "")
            .starts_with("HTTP/1.1 200"));
        let head = server.request("HEAD", "/docs/", &cookie, "");
        assert!(head.starts_with("HTTP/1.1 403"));
        assert!(body(&head).is_empty());

        let query = url.split_once('?').unwrap().1;
        let response = server.request("GET", &format!("/docs/?{query}"), "", "");
        let destination = format!("/docs/project/?{query}");
        assert!(body(&response).contains(&format!("href=\"{destination}\"")));
        assert!(server
            .request("GET", &destination, "", "")
            .starts_with("HTTP/1.1 303"));
    }

    #[test]
    fn jwt_grants_a_directory_tree_and_survives_new_state() {
        let mut server = Server::new();
        let (url, cookie) = server.share();
        let response = server.request(
            "GET",
            &format!("{url}&mode=raw"),
            "webdir_auth_token=stale",
            "",
        );
        assert!(response.starts_with("HTTP/1.1 303"));
        assert!(response.contains("Location: /docs/project/note.md?mode=raw\r\n"));
        assert!(response.contains(&format!(
            "Set-Cookie: {cookie}; Path=/; HttpOnly; SameSite=Lax"
        )));
        server.state = StateStore::new(None).unwrap();
        for path in [
            "/docs/project/note.md?mode=raw",
            "/docs/project/sub/child.md?mode=raw",
        ] {
            let response = server.request("GET", path, &cookie, "");
            assert!(response.starts_with("HTTP/1.1 200"), "{path}: {response}");
            assert_eq!(body(&response), "# Original\n");
        }
        for path in [
            "/",
            "/docs/",
            "/docs/project2/private.md",
            "/docs/project/%2e%2e/project2/private.md",
            "/docs/project/note.md?mode=share",
        ] {
            let response = server.request("GET", path, &cookie, "");
            assert!(response.starts_with("HTTP/1.1 403"), "{path}: {response}");
        }
        assert!(server
            .request("POST", "/docs/project/?mode=share", &cookie, "")
            .starts_with("HTTP/1.1 403"));
        assert!(server
            .request_with_secret("GET", &url, "", "", "changed")
            .starts_with("HTTP/1.1 403"));
        assert!(server
            .request_with_secret("GET", "/docs/project/note.md", &cookie, "", "changed")
            .starts_with("HTTP/1.1 403"));
        assert!(server
            .request(
                "GET",
                "/docs/project2/private.md",
                &format!("webdir_auth_token=secret; {cookie}"),
                ""
            )
            .starts_with("HTTP/1.1 200"));
        assert!(server
            .request(
                "GET",
                "/docs/project/note.md?mode=raw",
                &format!("webdir_auth_token=stale; {cookie}"),
                ""
            )
            .starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn signed_claims_support_unicode_and_reject_changed_scope_or_algorithm() {
        let server = Server::new();
        fs::create_dir(server.root().join("中文 %")).unwrap();
        let token = sign(Path::new("中文 %"), "secret").unwrap();
        let scope = Scope::verify(&token, "secret", &server.root()).unwrap();
        assert_eq!(scope.relative, Path::new("中文 %"));
        let root_token = sign(Path::new(""), "secret").unwrap();
        assert!(Scope::verify(&root_token, "secret", &server.root())
            .unwrap()
            .allows(&server.root().join("docs/project2/private.md")));
        let mut parts: Vec<&str> = token.split('.').collect();
        parts[1] = root_token.split('.').nth(1).unwrap();
        assert!(Scope::verify(&parts.join("."), "secret", &server.root()).is_none());
        let other = encode(
            &Header::new(Algorithm::HS384),
            &Claims { scope: "/".into() },
            &EncodingKey::from_secret(b"secret"),
        )
        .unwrap();
        assert!(Scope::verify(&other, "secret", &server.root()).is_none());
    }

    #[test]
    fn absolute_path_search_stays_in_the_shared_directory() {
        let server = Server::new();
        let (_, cookie) = server.share();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            server.root().join("docs/project2"),
            server.root().join("docs/project/linked-private"),
        )
        .unwrap();
        let search = |relative: &str| {
            let query =
                crate::percent_encode_component(&server.root().join(relative).to_string_lossy());
            let response = server.request(
                "GET",
                &format!("/docs/project/sub/?mode=file-search&q={query}"),
                &cookie,
                "",
            );
            assert!(response.starts_with("HTTP/1.1 200"));
            serde_json::from_str::<serde_json::Value>(body(&response)).unwrap()
        };
        let result = search("docs/project/note.md");
        assert_eq!(result["results"][0]["open_href"], "/docs/project/note.md");
        assert_eq!(result["results"][0]["directory"], "");
        let child = search("docs/project/sub/child.md");
        assert_eq!(child["results"][0]["directory"], "sub");
        for path in [
            "docs/project2/private.md",
            "docs/project/linked-private/private.md",
            "docs/project/missing/file.txt",
        ] {
            assert_eq!(search(path)["results"], serde_json::json!([]));
        }
    }

    #[test]
    fn shared_navigation_and_all_file_operations_stay_in_scope() {
        let server = Server::new();
        let (_, cookie) = server.share();
        for path in ["docs", "docs/project/sub", "docs/project2"] {
            server
                .state
                .set_directory_favourite(&server.root().join(path), true)
                .unwrap();
        }
        let page = server.request("GET", "/docs/project/", &cookie, "");
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("href=\"/docs/project/sub/\""));
        assert!(!page.contains("href=\"/docs/\""));
        assert!(!page.contains("href=\"/docs/project2/\""));
        let file_page = server.request("GET", "/docs/project/note.md", &cookie, "");
        assert!(file_page.contains("href=\"/docs/project/\">分享目录</a>"));
        assert!(file_page.contains("id=\"edit-button\""));
        assert!(server
            .request("GET", crate::YJS_PATH, &cookie, "")
            .starts_with("HTTP/1.1 200"));
        assert!(server
            .request("GET", "/favicon.svg", &cookie, "")
            .starts_with("HTTP/1.1 200"));
        assert!(server
            .request("HEAD", "/docs/project/note.md?mode=raw", &cookie, "")
            .ends_with("\r\n\r\n"));
        assert!(server
            .request(
                "PUT",
                "/docs/project/note.md?mode=raw",
                &cookie,
                "# Edited\n"
            )
            .starts_with("HTTP/1.1 204"));
        assert_eq!(
            fs::read_to_string(server.root().join("docs/project/note.md")).unwrap(),
            "# Edited\n"
        );
        assert!(server
            .request(
                "POST",
                "/docs/project/note.md?mode=preview",
                &cookie,
                "# Preview"
            )
            .contains("Preview</span></h1>"));
        assert!(server
            .request("GET", "/docs/project/note.md?mode=review-data", &cookie, "")
            .starts_with("HTTP/1.1 200"));
        assert!(server
            .request(
                "PUT",
                "/docs/project2/private.md?mode=raw",
                &cookie,
                "changed"
            )
            .starts_with("HTTP/1.1 403"));
        for mode in ["collab", "review-collab"] {
            assert!(server
                .request(
                    "GET",
                    &format!("/docs/project/note.md?mode={mode}"),
                    &cookie,
                    ""
                )
                .starts_with("HTTP/1.1 426"));
            assert!(server
                .request(
                    "GET",
                    &format!("/docs/project2/private.md?mode={mode}"),
                    &cookie,
                    ""
                )
                .starts_with("HTTP/1.1 403"));
        }
        let image = "/docs/project/%E7%8C%AB.svg";
        assert!(server
            .request(
                "PUT",
                &format!("{image}?mode=image-tag"),
                &cookie,
                r#"{"tag":2}"#
            )
            .starts_with("HTTP/1.1 204"));
        let moved = server.request(
            "POST",
            "/docs/project/?mode=batch-images",
            &cookie,
            r#"{"action":"move","files":["猫.svg"],"directory":"sub"}"#,
        );
        assert!(moved.contains("\"affected\":1"), "{moved}");
        let blocked = server.request(
            "POST",
            "/docs/project/sub/?mode=batch-images",
            &cookie,
            r#"{"action":"move","files":["猫.svg"],"directory":".."}"#,
        );
        assert!(blocked.contains("\"affected\":1"), "{blocked}");
        let blocked = server.request(
            "POST",
            "/docs/project/?mode=batch-images",
            &cookie,
            r#"{"action":"move","files":["猫.svg"],"directory":".."}"#,
        );
        assert!(blocked.contains("\"affected\":0"), "{blocked}");
        assert!(server
            .request(
                "POST",
                "/docs/project/?mode=directory-favourite-order",
                &cookie,
                r#"["/docs/project2/"]"#
            )
            .starts_with("HTTP/1.1 403"));
        assert!(server
            .request("DELETE", image, &cookie, "")
            .starts_with("HTTP/1.1 204"));
        assert!(!server.root().join("docs/project/猫.svg").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_targets_and_sidecars_obey_the_shared_boundary() {
        use std::os::unix::fs::symlink;
        let server = Server::new();
        let root = server.root();
        let (_, cookie) = server.share();
        symlink(
            root.join("docs/project2"),
            root.join("docs/project/outside"),
        )
        .unwrap();
        symlink(
            root.join("docs/project/sub"),
            root.join("docs/project/inside"),
        )
        .unwrap();
        fs::write(root.join("docs/project2/other.svg"), "<svg/>").unwrap();
        symlink(
            root.join("docs/project2/other.svg"),
            root.join("docs/project/leak.svg"),
        )
        .unwrap();
        let listing = server.request("GET", "/docs/project/?mode=directory-entries", &cookie, "");
        assert!(!listing.contains("\"listHref\":\"/docs/project/outside/\""));
        assert!(!listing.contains("leak.svg"));
        assert!(listing.contains("\"listHref\":\"/docs/project/inside/\""));
        assert!(server
            .request("GET", "/docs/project/inside/child.md", &cookie, "")
            .starts_with("HTTP/1.1 200"));
        for path in [
            "/docs/project/leak.svg?mode=asset",
            "/docs/project/outside/private.md",
        ] {
            assert!(server
                .request("GET", path, &cookie, "")
                .starts_with("HTTP/1.1 403"));
        }
        let moved = server.request(
            "POST",
            "/docs/project/?mode=batch-images",
            &cookie,
            r#"{"action":"move","files":["猫.svg"],"directory":"outside"}"#,
        );
        assert!(moved.contains("\"affected\":0"));
        let sorted = server.request("GET", "/docs/project/?mode=similarity-order", &cookie, "");
        assert!(!body(&sorted).contains("leak.svg"));
        fs::write(root.join("docs/project2/review.json"), "{}").unwrap();
        symlink(
            root.join("docs/project2/review.json"),
            root.join("docs/project/note.md.review.json"),
        )
        .unwrap();
        for mode in ["review-data", "review-collab"] {
            assert!(server
                .request(
                    "GET",
                    &format!("/docs/project/note.md?mode={mode}"),
                    &cookie,
                    ""
                )
                .starts_with("HTTP/1.1 403"));
        }
        assert!(server
            .request(
                "POST",
                "/docs/project/note.md?mode=review-action",
                &cookie,
                "{}"
            )
            .starts_with("HTTP/1.1 403"));
        symlink(
            root.join("docs/project2/review.json"),
            root.join("docs/project/gallery-comments.json"),
        )
        .unwrap();
        assert!(server
            .request(
                "GET",
                "/docs/project/%E7%8C%AB.svg?mode=gallery-comments",
                &cookie,
                ""
            )
            .starts_with("HTTP/1.1 403"));
        assert!(server
            .request("DELETE", "/docs/project/%E7%8C%AB.svg", &cookie, "")
            .starts_with("HTTP/1.1 403"));
        assert!(root.join("docs/project/猫.svg").exists());
    }
}
