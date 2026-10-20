use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{escape_html, url_for_path, Access, StateStore};

fn scope(access: &Access) -> &Path {
    access
        .scope
        .as_ref()
        .map_or(Path::new(""), |scope| &scope.relative)
}

fn history_scope(access: &Access) -> PathBuf {
    match &access.scope {
        Some(scope) => Path::new("/").join(&scope.relative),
        None => PathBuf::new(),
    }
}

pub(crate) fn link(access: &Access) -> String {
    format!(
        "<a class=\"recent-link\" href=\"{}?mode=recent\" title=\"最近访问的文件\"><svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M3.2 6.7A7 7 0 1 1 3 12.1M3 3.4v3.8h3.8M10 6v4l2.7 1.6\"/></svg><span>最近访问</span></a>",
        url_for_path(scope(access), true)
    )
}

pub(crate) fn record(
    state: &StateStore,
    root: &Path,
    relative: &Path,
    access: &Access,
    gallery: bool,
) -> io::Result<()> {
    state.record_visit(root, &history_scope(access), relative, gallery)
}

#[derive(serde::Serialize)]
pub(crate) struct Entry {
    name: String,
    path: String,
    href: String,
    visited_at: i64,
}

#[derive(serde::Serialize)]
pub(crate) struct Page {
    entries: Vec<Entry>,
    next_cursor: Option<String>,
}

pub(crate) fn parse_cursor(value: &str) -> Option<(i64, i64)> {
    let (time, id) = value.split_once(':')?;
    Some((time.parse().ok()?, id.parse().ok()?))
}

pub(crate) fn entries(
    root: &Path,
    state: &StateStore,
    access: &Access,
    query: &str,
    mut before: Option<(i64, i64)>,
) -> io::Result<Page> {
    let scope_key = history_scope(access);
    let query = query.trim().to_lowercase();
    let mut entries = Vec::new();
    let mut last_visible = None;
    loop {
        let visits = state.recent_files(root, &scope_key, before)?;
        if visits.is_empty() {
            return Ok(Page {
                entries,
                next_cursor: None,
            });
        }
        for visit in visits {
            before = Some((visit.visited_at, visit.id));
            let relative = &visit.path;
            let display = relative.strip_prefix(scope(access)).unwrap_or(relative);
            if !display.to_string_lossy().to_lowercase().contains(&query) {
                continue;
            }
            let path = root.join(relative);
            match fs::metadata(&path) {
                Ok(metadata) if metadata.is_file() => {}
                Ok(_) => {
                    state.remove_visit(root, &scope_key, relative)?;
                    continue;
                }
                Err(error) => {
                    if error.kind() == io::ErrorKind::NotFound {
                        state.remove_visit(root, &scope_key, relative)?;
                    }
                    continue;
                }
            }
            if !access.allows_request(root, relative) {
                continue;
            }
            if entries.len() == crate::state::RECENT_PAGE_SIZE {
                return Ok(Page {
                    entries,
                    next_cursor: last_visible,
                });
            }
            let href = if visit.gallery {
                format!(
                    "{}?view=gallery&open={}",
                    url_for_path(relative.parent().unwrap_or(Path::new("")), true),
                    crate::percent_encode_component(
                        &relative.file_name().unwrap_or_default().to_string_lossy()
                    ),
                )
            } else {
                url_for_path(relative, false)
            };
            entries.push(Entry {
                name: display
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                path: display.to_string_lossy().into_owned(),
                href,
                visited_at: visit.visited_at / 1000,
            });
            last_visible = Some(format!("{}:{}", visit.visited_at, visit.id));
        }
    }
}

pub(crate) fn page(
    root: &Path,
    state: &StateStore,
    access: &Access,
    query: &str,
) -> io::Result<String> {
    let page = entries(root, state, access, query, None)?;
    let mut rows = String::new();
    for entry in &page.entries {
        let href = escape_html(&entry.href);
        let name = escape_html(&entry.name);
        let label = escape_html(&entry.path);
        rows.push_str(&format!(
            "<a class=\"entry\" href=\"{href}\"><span class=\"glyph\" aria-hidden=\"true\">↗</span><span class=\"name\">{name}<small>{label}</small></span><time class=\"detail\" data-visited-at=\"{}\">最近访问</time></a>",
            entry.visited_at
        ));
    }
    let count = page.entries.len();
    if count == 0 {
        let message = if query.trim().is_empty() {
            "还没有最近访问的文件"
        } else {
            "没有匹配的访问记录"
        };
        rows.push_str(&format!("<div class=\"empty\" role=\"status\"><span aria-hidden=\"true\">◷</span><p>{message}</p></div>"));
    }
    let breadcrumbs = crate::render_breadcrumbs_with_access(scope(access), access);
    let css = crate::DIRECTORY_CSS;
    let script = include_str!("../assets/recent.js");
    let query = escape_html(query);
    let more_hidden = if page.next_cursor.is_some() {
        ""
    } else {
        "hidden"
    };
    let cursor = page.next_cursor.unwrap_or_default();
    Ok(format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\"><title>最近访问</title><style>{css}
        main>header::after {{ content:none; }}
        .listing .entry {{ grid-template-columns:2.4rem minmax(0,1fr) auto; }}
        .name {{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }}
        .name small {{ display:block; margin-top:.35rem; color:var(--muted); font-size:.75rem; font-weight:400; overflow:hidden; text-overflow:ellipsis; }}
        .recent-search {{ margin-top:1.2rem; }}
        .recent-pagination {{ display:grid; justify-items:center; gap:.6rem; padding:1.2rem; color:var(--muted); font-size:.8rem; }}
        .recent-pagination p {{ margin:0; }}
        #recent-more {{ padding:.6rem 1.2rem; border:1px solid var(--line); border-radius:.5rem; color:var(--accent); background:var(--surface); font:inherit; cursor:pointer; }}
        #recent-more:focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
        #recent-more:disabled {{ opacity:.6; cursor:wait; }}
        @media(max-width:650px) {{ .listing .entry {{ grid-template-columns:2rem minmax(0,1fr); }} .listing .detail {{ grid-column:2; justify-self:start; }} }}
        </style></head><body><main><nav class=\"breadcrumbs\" aria-label=\"当前位置\">{breadcrumbs}<span aria-hidden=\"true\">/</span><span aria-current=\"page\">最近访问</span></nav><header><p class=\"eyebrow\">WEBDIR / 最近访问</p><h1>最近访问</h1><p class=\"summary\">已显示 {count} 个文件 · 按访问时间倒序</p><div class=\"recent-search\"><label class=\"file-search-box\" for=\"recent-search\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"10\" cy=\"10\" r=\"6.5\"></circle><path d=\"m14.8 14.8 5.2 5.2\"></path></svg><input id=\"recent-search\" type=\"search\" aria-label=\"搜索最近访问\" placeholder=\"搜索文件名或路径…\" value=\"{query}\" autocomplete=\"off\"></label></div></header><section class=\"listing\" aria-label=\"最近访问的文件\">{rows}</section><footer class=\"recent-pagination\"><p id=\"recent-status\" role=\"status\"></p><button id=\"recent-more\" type=\"button\" data-cursor=\"{cursor}\" {more_hidden}>加载更多</button></footer></main><script>{script}</script></body></html>"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_fill_after_deleted_records_and_search_all_retained_paths() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let state = StateStore::new(None).unwrap();
        let access = Access::default();
        fs::create_dir(root.join("设计资料")).unwrap();
        let named = Path::new("设计资料/Report_100%.md");
        fs::write(root.join(named), "# Report").unwrap();
        record(&state, root, named, &access, false).unwrap();
        for index in 0..105 {
            let relative = PathBuf::from(format!("file-{index:03}.md"));
            fs::write(root.join(&relative), "# File").unwrap();
            record(&state, root, &relative, &access, false).unwrap();
        }
        for index in 0..60 {
            record(
                &state,
                root,
                Path::new(&format!("missing-{index}.md")),
                &access,
                false,
            )
            .unwrap();
        }
        let first = entries(root, &state, &access, "", None).unwrap();
        assert_eq!(first.entries.len(), 50);
        assert_eq!(first.entries[0].name, "file-104.md");
        let second = entries(
            root,
            &state,
            &access,
            "",
            parse_cursor(first.next_cursor.as_ref().unwrap()),
        )
        .unwrap();
        assert_eq!(second.entries.len(), 50);
        assert_eq!(second.entries[0].name, "file-054.md");
        let third = entries(
            root,
            &state,
            &access,
            "",
            parse_cursor(second.next_cursor.as_ref().unwrap()),
        )
        .unwrap();
        assert_eq!(third.entries.len(), 6);
        assert!(third.next_cursor.is_none());
        for query in ["REPORT", "设计资料/report_", "100%", "_100"] {
            let found = entries(root, &state, &access, query, None).unwrap();
            assert_eq!(found.entries.len(), 1, "{query}");
            assert_eq!(found.entries[0].path, named.to_string_lossy());
            assert!(found.next_cursor.is_none());
        }
        assert!(entries(root, &state, &access, "missing", None)
            .unwrap()
            .entries
            .is_empty());
        assert_eq!(
            state.recent_files(root, Path::new(""), None).unwrap()[0].path,
            Path::new("file-104.md")
        );
    }
}
