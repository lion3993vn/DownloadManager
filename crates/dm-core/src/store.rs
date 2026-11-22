//! SQLite persistence so downloads survive restarts and crashes.

use crate::error::Result;
use crate::types::{DownloadId, DownloadInfo, DownloadKind, RequestHeaders, SegmentInfo, Status};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Store {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS downloads (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    url            TEXT NOT NULL,
    file_name      TEXT NOT NULL,
    save_dir       TEXT NOT NULL,
    total_size     INTEGER,
    downloaded     INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL,
    error          TEXT,
    resumable      INTEGER NOT NULL DEFAULT 0,
    connections    INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    completed_at   INTEGER,
    referrer       TEXT,
    user_agent     TEXT,
    cookies        TEXT,
    etag           TEXT,
    last_modified  TEXT,
    auto_name      INTEGER NOT NULL DEFAULT 0,
    kind           TEXT NOT NULL DEFAULT 'file'
);
CREATE TABLE IF NOT EXISTS segments (
    download_id  INTEGER NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    start        INTEGER NOT NULL,
    end          INTEGER NOT NULL,
    done         INTEGER NOT NULL,
    PRIMARY KEY (download_id, idx)
);
CREATE TABLE IF NOT EXISTS kv (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"#;

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Insert a new row and return its id. `info.id` is ignored.
    pub fn insert(&self, info: &DownloadInfo) -> Result<DownloadId> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO downloads (url, file_name, save_dir, total_size, downloaded, status, error,
                resumable, connections, created_at, completed_at, referrer, user_agent, cookies,
                etag, last_modified, auto_name, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                info.url,
                info.file_name,
                info.save_dir.to_string_lossy(),
                info.total_size.map(|v| v as i64),
                info.downloaded as i64,
                info.status.as_str(),
                info.error,
                info.resumable,
                info.connections,
                info.created_at,
                info.completed_at,
                info.headers.referrer,
                info.headers.user_agent,
                info.headers.cookies,
                info.etag,
                info.last_modified,
                info.auto_name,
                info.kind.as_str(),
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Persist every mutable field plus the segment table.
    pub fn save(&self, info: &DownloadInfo) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE downloads SET file_name=?2, save_dir=?3, total_size=?4, downloaded=?5, status=?6,
                error=?7, resumable=?8, connections=?9, completed_at=?10, etag=?11,
                last_modified=?12, auto_name=?13, kind=?14
             WHERE id=?1",
            params![
                info.id,
                info.file_name,
                info.save_dir.to_string_lossy(),
                info.total_size.map(|v| v as i64),
                info.downloaded as i64,
                info.status.as_str(),
                info.error,
                info.resumable,
                info.connections,
                info.completed_at,
                info.etag,
                info.last_modified,
                info.auto_name,
                info.kind.as_str(),
            ],
        )?;
        tx.execute("DELETE FROM segments WHERE download_id=?1", [info.id])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO segments (download_id, idx, start, end, done) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for (i, s) in info.segments.iter().enumerate() {
                stmt.execute(params![
                    info.id,
                    i as i64,
                    s.start as i64,
                    s.end as i64,
                    s.done as i64
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete(&self, id: DownloadId) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM downloads WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<DownloadInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, url, file_name, save_dir, total_size, downloaded, status, error, resumable,
                connections, created_at, completed_at, referrer, user_agent, cookies, etag,
                last_modified, auto_name, kind
             FROM downloads ORDER BY id",
        )?;
        let mut downloads = stmt
            .query_map([], |r| {
                Ok(DownloadInfo {
                    id: r.get(0)?,
                    url: r.get(1)?,
                    kind: DownloadKind::parse(&r.get::<_, String>(18)?),
                    file_name: r.get(2)?,
                    save_dir: PathBuf::from(r.get::<_, String>(3)?),
                    total_size: r.get::<_, Option<i64>>(4)?.map(|v| v as u64),
                    downloaded: r.get::<_, i64>(5)? as u64,
                    status: Status::parse(&r.get::<_, String>(6)?),
                    error: r.get(7)?,
                    resumable: r.get(8)?,
                    connections: r.get(9)?,
                    created_at: r.get(10)?,
                    completed_at: r.get(11)?,
                    headers: RequestHeaders {
                        referrer: r.get(12)?,
                        user_agent: r.get(13)?,
                        cookies: r.get(14)?,
                    },
                    etag: r.get(15)?,
                    last_modified: r.get(16)?,
                    auto_name: r.get(17)?,
                    segments: Vec::new(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut seg_stmt = conn
            .prepare("SELECT start, end, done FROM segments WHERE download_id=?1 ORDER BY idx")?;
        for d in &mut downloads {
            d.segments = seg_stmt
                .query_map([d.id], |r| {
                    Ok(SegmentInfo {
                        start: r.get::<_, i64>(0)? as u64,
                        end: r.get::<_, i64>(1)? as u64,
                        done: r.get::<_, i64>(2)? as u64,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
        }
        Ok(downloads)
    }

    pub fn get_kv(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT value FROM kv WHERE key=?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_kv(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [key, value],
        )?;
        Ok(())
    }
}

/// Bring databases created by older versions up to the current schema.
fn migrate(conn: &Connection) -> Result<()> {
    let has_kind = conn
        .prepare("SELECT 1 FROM pragma_table_info('downloads') WHERE name='kind'")?
        .exists([])?;
    if !has_kind {
        conn.execute_batch("ALTER TABLE downloads ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_databases_without_kind() {
        let old_schema = SCHEMA.replace(",\n    kind           TEXT NOT NULL DEFAULT 'file'", "");
        assert!(!old_schema.contains("kind"));
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&old_schema).unwrap();
        conn.execute(
            "INSERT INTO downloads (url, file_name, save_dir, status, connections, created_at)
             VALUES ('https://a.com/x.zip', 'x.zip', '/tmp', 'paused', 8, 0)",
            [],
        )
        .unwrap();

        let store = Store::init(conn).unwrap();
        let mut all = store.load_all().unwrap();
        assert_eq!(all[0].kind, DownloadKind::File);
        all[0].kind = DownloadKind::Hls;
        store.save(&all[0]).unwrap();
        assert_eq!(store.load_all().unwrap()[0].kind, DownloadKind::Hls);
    }
}
