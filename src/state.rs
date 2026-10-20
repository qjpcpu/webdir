use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

#[derive(Clone)]
pub(crate) struct StateStore {
    connection: Arc<Mutex<Connection>>,
}

pub(crate) const RECENT_PAGE_SIZE: usize = 50;

pub(crate) struct RecentVisit {
    pub(crate) path: PathBuf,
    pub(crate) visited_at: i64,
    pub(crate) gallery: bool,
    pub(crate) id: i64,
}

impl StateStore {
    pub(crate) fn new(cache_root: Option<&Path>) -> io::Result<Self> {
        let connection = match cache_root {
            Some(root) => {
                fs::create_dir_all(root)?;
                Connection::open(root.join("webdir.sqlite")).map_err(sqlite_error)?
            }
            None => Connection::open_in_memory().map_err(sqlite_error)?,
        };
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS recent_files (
                    root BLOB NOT NULL,
                    scope BLOB NOT NULL,
                    path BLOB NOT NULL,
                    visited_at INTEGER NOT NULL,
                    gallery INTEGER NOT NULL,
                    PRIMARY KEY (root, scope, path)
                );
                CREATE INDEX IF NOT EXISTS recent_files_by_visit
                    ON recent_files (root, scope, visited_at DESC);
                CREATE TABLE IF NOT EXISTS favourites (
                    path BLOB PRIMARY KEY NOT NULL
                );
                CREATE TABLE IF NOT EXISTS image_tags (
                    path BLOB PRIMARY KEY NOT NULL,
                    tag INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS directory_favourites (
                    path BLOB PRIMARY KEY NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS directory_favourite_labels (
                    path BLOB PRIMARY KEY NOT NULL,
                    label TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS image_similarity_features (
                    path BLOB PRIMARY KEY NOT NULL,
                    source_version TEXT NOT NULL,
                    feature BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS image_similarity_orders (
                    path BLOB PRIMARY KEY NOT NULL,
                    source_version TEXT NOT NULL,
                    image_order TEXT NOT NULL
                );",
            )
            .map_err(sqlite_error)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub(crate) fn record_visit(
        &self,
        root: &Path,
        scope: &Path,
        path: &Path,
        gallery: bool,
    ) -> io::Result<()> {
        let visited_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros() as i64;
        let mut connection = self.connection.lock().unwrap();
        let transaction = connection.transaction().map_err(sqlite_error)?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO recent_files (root, scope, path, visited_at, gallery) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![path_bytes(root), path_bytes(scope), path_bytes(path), visited_at, gallery],
            )
            .map_err(sqlite_error)?;
        transaction
            .execute(
                "DELETE FROM recent_files WHERE root = ?1 AND scope = ?2 AND path IN (
                    SELECT path FROM recent_files WHERE root = ?1 AND scope = ?2
                    ORDER BY visited_at DESC, rowid DESC LIMIT -1 OFFSET 1000
                )",
                params![path_bytes(root), path_bytes(scope)],
            )
            .map_err(sqlite_error)?;
        transaction.commit().map_err(sqlite_error)
    }

    pub(crate) fn recent_files(
        &self,
        root: &Path,
        scope: &Path,
        before: Option<(i64, i64)>,
    ) -> io::Result<Vec<RecentVisit>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection
            .prepare(
                "SELECT path, visited_at, gallery, rowid FROM recent_files
                 WHERE root = ?1 AND scope = ?2 AND (visited_at, rowid) < (?3, ?4)
                 ORDER BY visited_at DESC, rowid DESC LIMIT ?5",
            )
            .map_err(sqlite_error)?;
        let (visited_at, id) = before.unwrap_or((i64::MAX, i64::MAX));
        let rows = statement
            .query_map(
                params![
                    path_bytes(root),
                    path_bytes(scope),
                    visited_at,
                    id,
                    RECENT_PAGE_SIZE as i64
                ],
                |row| {
                    let bytes: Vec<u8> = row.get(0)?;
                    Ok(RecentVisit {
                        path: PathBuf::from(unsafe {
                            std::ffi::OsString::from_encoded_bytes_unchecked(bytes)
                        }),
                        visited_at: row.get(1)?,
                        gallery: row.get(2)?,
                        id: row.get(3)?,
                    })
                },
            )
            .map_err(sqlite_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
    }

    pub(crate) fn remove_visit(&self, root: &Path, scope: &Path, path: &Path) -> io::Result<()> {
        self.connection
            .lock()
            .unwrap()
            .execute(
                "DELETE FROM recent_files WHERE root = ?1 AND scope = ?2 AND path = ?3",
                params![path_bytes(root), path_bytes(scope), path_bytes(path)],
            )
            .map(|_| ())
            .map_err(sqlite_error)
    }

    pub(crate) fn is_favourite(&self, path: &Path) -> io::Result<bool> {
        self.contains("favourites", path)
    }

    pub(crate) fn set_favourite(&self, path: &Path, value: bool) -> io::Result<()> {
        self.set("favourites", path, value)
    }

    pub(crate) fn directory_image_state(&self, path: &Path) -> io::Result<(bool, Option<u8>)> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare_cached(
            "SELECT EXISTS(SELECT 1 FROM favourites WHERE path = ?1), (SELECT tag FROM image_tags WHERE path = ?1)"
        ).map_err(sqlite_error)?;
        statement
            .query_row(params![path_bytes(path)], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(sqlite_error)
    }

    pub(crate) fn image_tag(&self, path: &Path) -> io::Result<Option<u8>> {
        self.connection
            .lock()
            .unwrap()
            .query_row(
                "SELECT tag FROM image_tags WHERE path = ?1",
                params![path_bytes(path)],
                |row| row.get(0),
            )
            .optional()
            .map_err(sqlite_error)
    }

    pub(crate) fn set_image_tag(&self, path: &Path, tag: Option<u8>) -> io::Result<()> {
        let connection = self.connection.lock().unwrap();
        match tag {
            Some(tag) => connection.execute(
                "INSERT OR REPLACE INTO image_tags (path, tag) VALUES (?1, ?2)",
                params![path_bytes(path), tag],
            ),
            None => connection.execute(
                "DELETE FROM image_tags WHERE path = ?1",
                params![path_bytes(path)],
            ),
        }
        .map(|_| ())
        .map_err(sqlite_error)
    }

    pub(crate) fn is_directory_favourite(&self, path: &Path) -> io::Result<bool> {
        self.contains("directory_favourites", path)
    }

    pub(crate) fn set_directory_favourite(&self, path: &Path, value: bool) -> io::Result<()> {
        let mut connection = self.connection.lock().unwrap();
        if value {
            let created_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            connection
                .execute(
                    "INSERT OR IGNORE INTO directory_favourites (path, created_at) VALUES (?1, ?2)",
                    params![path_bytes(path), created_at],
                )
                .map(|_| ())
                .map_err(sqlite_error)
        } else {
            let transaction = connection.transaction().map_err(sqlite_error)?;
            transaction
                .execute(
                    "DELETE FROM directory_favourites WHERE path = ?1",
                    params![path_bytes(path)],
                )
                .map_err(sqlite_error)?;
            transaction
                .execute(
                    "DELETE FROM directory_favourite_labels WHERE path = ?1",
                    params![path_bytes(path)],
                )
                .map_err(sqlite_error)?;
            transaction.commit().map_err(sqlite_error)
        }
    }

    pub(crate) fn directory_favourite_label(&self, path: &Path) -> io::Result<Option<String>> {
        let connection = self.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT label FROM directory_favourite_labels WHERE path = ?1",
                params![path_bytes(path)],
                |row| row.get(0),
            )
            .optional()
            .map_err(sqlite_error)
    }

    pub(crate) fn set_directory_favourite_label(&self, path: &Path, label: &str) -> io::Result<()> {
        let connection = self.connection.lock().unwrap();
        connection
            .execute(
                "INSERT OR REPLACE INTO directory_favourite_labels (path, label) VALUES (?1, ?2)",
                params![path_bytes(path), label],
            )
            .map(|_| ())
            .map_err(sqlite_error)
    }

    pub(crate) fn directory_favourites_within(&self, root: &Path) -> io::Result<Vec<PathBuf>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection
            .prepare("SELECT path FROM directory_favourites ORDER BY created_at ASC, rowid ASC")
            .map_err(sqlite_error)?;
        let paths = statement
            .query_map([], |row| {
                let bytes: Vec<u8> = row.get(0)?;
                Ok(PathBuf::from(unsafe {
                    std::ffi::OsString::from_encoded_bytes_unchecked(bytes)
                }))
            })
            .map_err(sqlite_error)?;
        let paths = paths.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?;
        Ok(paths
            .into_iter()
            .filter(|path| path.starts_with(root))
            .collect())
    }

    pub(crate) fn reorder_directory_favourites(&self, ordered: &[PathBuf]) -> io::Result<()> {
        let mut connection = self.connection.lock().unwrap();
        let transaction = connection.transaction().map_err(sqlite_error)?;
        let mut favourites = {
            let mut statement = transaction
                .prepare("SELECT path FROM directory_favourites ORDER BY created_at ASC, rowid ASC")
                .map_err(sqlite_error)?;
            let paths = statement
                .query_map([], |row| {
                    let bytes: Vec<u8> = row.get(0)?;
                    Ok(PathBuf::from(unsafe {
                        std::ffi::OsString::from_encoded_bytes_unchecked(bytes)
                    }))
                })
                .map_err(sqlite_error)?;
            paths.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)?
        };
        let reordered = ordered.iter().collect::<HashSet<_>>();
        let mut replacements = ordered.iter();
        for path in &mut favourites {
            if reordered.contains(path) {
                *path = replacements.next().unwrap().clone();
            }
        }
        for (index, path) in favourites.iter().enumerate() {
            transaction
                .execute(
                    "UPDATE directory_favourites SET created_at = ?1 WHERE path = ?2",
                    params![index as i64, path_bytes(path)],
                )
                .map_err(sqlite_error)?;
        }
        transaction.commit().map_err(sqlite_error)
    }

    pub(crate) fn clear_image_state(&self, path: &Path) -> io::Result<()> {
        self.clear_images(&[path.to_path_buf()], true, true, true)
    }

    pub(crate) fn clear_images(
        &self,
        paths: &[PathBuf],
        favourites: bool,
        tags: bool,
        features: bool,
    ) -> io::Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut connection = self.connection.lock().unwrap();
        let transaction = connection.transaction().map_err(sqlite_error)?;
        for (enabled, sql) in [
            (favourites, "DELETE FROM favourites WHERE path = ?1"),
            (tags, "DELETE FROM image_tags WHERE path = ?1"),
            (
                features,
                "DELETE FROM image_similarity_features WHERE path = ?1",
            ),
        ] {
            if enabled {
                let mut statement = transaction.prepare(sql).map_err(sqlite_error)?;
                for path in paths {
                    statement
                        .execute(params![path_bytes(path)])
                        .map_err(sqlite_error)?;
                }
            }
        }
        transaction.commit().map_err(sqlite_error)
    }

    pub(crate) fn image_similarity_feature(
        &self,
        path: &Path,
        source_version: &str,
    ) -> io::Result<Option<Vec<u8>>> {
        let connection = self.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT feature FROM image_similarity_features WHERE path = ?1 AND source_version = ?2",
                params![path_bytes(path), source_version],
                |row| row.get(0),
            )
            .optional()
            .map_err(sqlite_error)
    }

    pub(crate) fn set_image_similarity_feature(
        &self,
        path: &Path,
        source_version: &str,
        feature: &[u8],
    ) -> io::Result<()> {
        let connection = self.connection.lock().unwrap();
        connection
            .execute(
                "INSERT OR REPLACE INTO image_similarity_features (path, source_version, feature) VALUES (?1, ?2, ?3)",
                params![path_bytes(path), source_version, feature],
            )
            .map(|_| ())
            .map_err(sqlite_error)
    }

    pub(crate) fn image_similarity_order(
        &self,
        path: &Path,
        source_version: &str,
    ) -> io::Result<Option<String>> {
        let connection = self.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT image_order FROM image_similarity_orders WHERE path = ?1 AND source_version = ?2",
                params![path_bytes(path), source_version],
                |row| row.get(0),
            )
            .optional()
            .map_err(sqlite_error)
    }

    pub(crate) fn set_image_similarity_order(
        &self,
        path: &Path,
        source_version: &str,
        image_order: &str,
    ) -> io::Result<()> {
        let connection = self.connection.lock().unwrap();
        connection
            .execute(
                "INSERT OR REPLACE INTO image_similarity_orders (path, source_version, image_order) VALUES (?1, ?2, ?3)",
                params![path_bytes(path), source_version, image_order],
            )
            .map(|_| ())
            .map_err(sqlite_error)
    }

    fn contains(&self, table: &str, path: &Path) -> io::Result<bool> {
        let connection = self.connection.lock().unwrap();
        connection
            .query_row(
                &format!("SELECT 1 FROM {table} WHERE path = ?1"),
                params![path_bytes(path)],
                |_| Ok(()),
            )
            .optional()
            .map(|row| row.is_some())
            .map_err(sqlite_error)
    }

    fn set(&self, table: &str, path: &Path, value: bool) -> io::Result<()> {
        let connection = self.connection.lock().unwrap();
        let statement = if value {
            format!("INSERT OR IGNORE INTO {table} (path) VALUES (?1)")
        } else {
            format!("DELETE FROM {table} WHERE path = ?1")
        };
        connection
            .execute(&statement, params![path_bytes(path)])
            .map(|_| ())
            .map_err(sqlite_error)
    }
}

fn path_bytes(path: &Path) -> &[u8] {
    path.as_os_str().as_encoded_bytes()
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_visits(state: &StateStore, root: &Path, scope: &Path) -> Vec<RecentVisit> {
        let mut visits = Vec::new();
        let mut before = None;
        loop {
            let page = state.recent_files(root, scope, before).unwrap();
            if page.is_empty() {
                return visits;
            }
            assert!(page.len() <= RECENT_PAGE_SIZE);
            let last = page.last().unwrap();
            before = Some((last.visited_at, last.id));
            visits.extend(page);
        }
    }

    #[test]
    fn recent_visits_persist_and_are_ordered_within_their_root_and_scope() {
        let cache = tempfile::tempdir().unwrap();
        let root = Path::new("/workspace");
        let scope = Path::new("");
        let first = Path::new("first.md");
        let second = Path::new("second.md");
        let state = StateStore::new(Some(cache.path())).unwrap();
        state.record_visit(root, scope, first, false).unwrap();
        state.record_visit(root, scope, second, true).unwrap();
        state.record_visit(root, scope, first, true).unwrap();
        state
            .record_visit(root, Path::new("/"), second, false)
            .unwrap();
        state
            .record_visit(Path::new("/other"), scope, second, false)
            .unwrap();
        drop(state);

        let state = StateStore::new(Some(cache.path())).unwrap();
        let visits = all_visits(&state, root, scope);
        assert_eq!(visits.len(), 2);
        assert_eq!(visits[0].path, first);
        assert_eq!(visits[1].path, second);
        assert!(visits[0].gallery);
        assert!(visits[1].gallery);
        assert!(visits[0].visited_at >= visits[1].visited_at);
        state.record_visit(root, scope, first, false).unwrap();
        assert!(!all_visits(&state, root, scope)[0].gallery);
        state.remove_visit(root, scope, first).unwrap();
        assert_eq!(all_visits(&state, root, scope).len(), 1);
        assert_eq!(all_visits(&state, root, Path::new("/")).len(), 1);
    }

    #[test]
    fn recent_visits_keep_the_latest_thousand_per_root_and_scope() {
        let state = StateStore::new(None).unwrap();
        let root = Path::new("/workspace");
        let scope = Path::new("");
        let shared = Path::new("/docs");
        let first = Path::new("0.md");
        state.record_visit(root, shared, first, false).unwrap();
        state
            .record_visit(Path::new("/other"), scope, first, false)
            .unwrap();
        for index in 0..1005 {
            state
                .record_visit(root, scope, Path::new(&format!("{index}.md")), false)
                .unwrap();
        }
        let visits = all_visits(&state, root, scope);
        assert_eq!(visits.len(), 1000);
        assert_eq!(visits[0].path, Path::new("1004.md"));
        assert_eq!(visits[999].path, Path::new("5.md"));

        state
            .record_visit(root, scope, Path::new("5.md"), false)
            .unwrap();
        let visits = all_visits(&state, root, scope);
        assert_eq!(visits.len(), 1000);
        assert_eq!(visits[0].path, Path::new("5.md"));
        state.record_visit(root, scope, first, false).unwrap();
        let visits = all_visits(&state, root, scope);
        assert_eq!(visits.len(), 1000);
        assert_eq!(visits[0].path, first);
        assert!(!visits.iter().any(|visit| visit.path == Path::new("6.md")));
        assert_eq!(all_visits(&state, root, shared).len(), 1);
        assert_eq!(all_visits(&state, Path::new("/other"), scope).len(), 1);
    }

    #[test]
    fn recent_cursor_orders_ties_and_survives_new_visits_and_deletions() {
        let state = StateStore::new(None).unwrap();
        let root = Path::new("/workspace");
        let scope = Path::new("");
        for index in 0..105 {
            state
                .record_visit(root, scope, Path::new(&format!("{index}.md")), false)
                .unwrap();
        }
        state
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE recent_files SET visited_at = 100 WHERE root = ?1 AND scope = ?2",
                params![path_bytes(root), path_bytes(scope)],
            )
            .unwrap();
        let first = state.recent_files(root, scope, None).unwrap();
        assert_eq!(first.len(), 50);
        assert_eq!(first[0].path, Path::new("104.md"));
        assert_eq!(first[49].path, Path::new("55.md"));
        let cursor = Some((first[49].visited_at, first[49].id));
        state
            .record_visit(root, scope, Path::new("0.md"), false)
            .unwrap();
        state
            .record_visit(root, scope, Path::new("new.md"), false)
            .unwrap();
        state.remove_visit(root, scope, Path::new("54.md")).unwrap();
        let second = state.recent_files(root, scope, cursor).unwrap();
        assert_eq!(second.len(), 50);
        assert_eq!(second[0].path, Path::new("53.md"));
        assert_eq!(second[49].path, Path::new("4.md"));
        let third = state
            .recent_files(root, scope, Some((second[49].visited_at, second[49].id)))
            .unwrap();
        assert_eq!(third.len(), 3);
        assert_eq!(third[2].path, Path::new("1.md"));
    }

    #[test]
    fn clearing_images_rolls_back_all_marks_on_database_failure() {
        let state = StateStore::new(None).unwrap();
        let paths = vec![PathBuf::from("a.svg"), PathBuf::from("b.svg")];
        for path in &paths {
            state.set_favourite(path, true).unwrap();
            state.set_image_tag(path, Some(2)).unwrap();
        }
        state.connection.lock().unwrap().execute_batch(
            "CREATE TRIGGER fail_clear BEFORE DELETE ON image_tags BEGIN SELECT RAISE(ABORT, 'failed'); END;"
        ).unwrap();
        assert!(state.clear_images(&paths, true, true, false).is_err());
        for path in &paths {
            assert!(state.is_favourite(path).unwrap());
            assert_eq!(state.image_tag(path).unwrap(), Some(2));
        }
    }

    #[test]
    fn memory_database_is_shared_by_clones_and_isolated_by_instance() {
        let state = StateStore::new(None).unwrap();
        let path = Path::new("/photos/cat.png");
        state.set_favourite(path, true).unwrap();
        state.set_image_tag(path, Some(1)).unwrap();

        assert!(state.clone().is_favourite(path).unwrap());
        assert_eq!(state.clone().image_tag(path).unwrap(), Some(1));
        state.set_image_tag(path, Some(5)).unwrap();
        assert_eq!(state.image_tag(path).unwrap(), Some(5));
        assert!(!StateStore::new(None).unwrap().is_favourite(path).unwrap());

        state.clear_image_state(path).unwrap();
        assert!(!state.is_favourite(path).unwrap());
        assert_eq!(state.image_tag(path).unwrap(), None);
    }

    #[test]
    fn disk_database_persists_both_state_tables() {
        let cache = tempfile::tempdir().unwrap();
        let first = Path::new("/photos/猫.png");
        let second = Path::new("/other/猫.png");
        let state = StateStore::new(Some(cache.path())).unwrap();
        state.set_favourite(first, true).unwrap();
        state.set_image_tag(second, Some(3)).unwrap();
        state
            .set_image_similarity_feature(first, "v1", &[1, 2, 3])
            .unwrap();
        state
            .set_image_similarity_order(Path::new("/photos"), "v1", "[\"猫.png\"]")
            .unwrap();
        drop(state);

        let reopened = StateStore::new(Some(cache.path())).unwrap();
        assert!(reopened.is_favourite(first).unwrap());
        assert_eq!(reopened.image_tag(second).unwrap(), Some(3));
        assert_eq!(
            reopened.image_similarity_feature(first, "v1").unwrap(),
            Some(vec![1, 2, 3])
        );
        assert_eq!(
            reopened.image_similarity_feature(first, "v2").unwrap(),
            None
        );
        assert_eq!(
            reopened
                .image_similarity_order(Path::new("/photos"), "v1")
                .unwrap()
                .as_deref(),
            Some("[\"猫.png\"]")
        );
        assert!(cache.path().join("webdir.sqlite").is_file());
        assert!(!cache.path().join("favourites").exists());
    }

    #[test]
    fn directory_favourites_can_be_reordered_and_are_limited_to_the_serving_root() {
        let cache = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path().join("photos");
        let nested = root.join("nested");
        let other = workspace.path().join("other");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir(&other).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let nested = fs::canonicalize(nested).unwrap();
        let other = fs::canonicalize(other).unwrap();

        let state = StateStore::new(Some(cache.path())).unwrap();
        state.set_directory_favourite(&root, true).unwrap();
        state.set_directory_favourite(&other, true).unwrap();
        state.set_directory_favourite(&nested, true).unwrap();

        assert_eq!(
            state.directory_favourites_within(&root).unwrap(),
            vec![root.clone(), nested.clone()]
        );
        assert!(state.is_directory_favourite(&other).unwrap());
        state
            .reorder_directory_favourites(&[nested.clone(), root.clone()])
            .unwrap();
        state
            .set_directory_favourite_label(&nested, "常用图片")
            .unwrap();
        assert_eq!(
            state.directory_favourite_label(&nested).unwrap().as_deref(),
            Some("常用图片")
        );
        assert_eq!(
            state.directory_favourites_within(&root).unwrap(),
            vec![nested.clone(), root.clone()]
        );
        state.set_directory_favourite(&root, false).unwrap();
        assert_eq!(
            state.directory_favourites_within(&root).unwrap(),
            vec![nested.clone()]
        );
        state.set_directory_favourite(&nested, false).unwrap();
        assert_eq!(state.directory_favourite_label(&nested).unwrap(), None);
    }
}
