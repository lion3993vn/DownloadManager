//! HTTP client setup and URL probing.

use crate::error::{Error, Result};
use crate::naming;
use crate::types::{ProbeResult, RequestHeaders};
use reqwest::header::{self, HeaderMap};
use reqwest::{Client, RequestBuilder, StatusCode};
use std::time::Duration;

pub const DEFAULT_USER_AGENT: &str = concat!("DownloadManager/", env!("CARGO_PKG_VERSION"));

pub fn build_client() -> Result<Client> {
    Ok(Client::builder()
        // HTTP/2 would multiplex all "parallel" connections onto a single TCP
        // stream and defeat the purpose of segmenting, so force HTTP/1.1.
        .http1_only()
        .connect_timeout(Duration::from_secs(15))
        .pool_max_idle_per_host(crate::types::MAX_CONNECTIONS as usize)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?)
}

pub fn request(client: &Client, url: &str, headers: &RequestHeaders) -> RequestBuilder {
    // Ask for the raw bytes: compressed transfer would make byte ranges meaningless.
    let mut req = client.get(url).header(header::ACCEPT_ENCODING, "identity");
    req = req.header(
        header::USER_AGENT,
        headers.user_agent.as_deref().unwrap_or(DEFAULT_USER_AGENT),
    );
    if let Some(referrer) = headers.referrer.as_deref().filter(|r| !r.is_empty()) {
        req = req.header(header::REFERER, referrer);
    }
    if let Some(cookies) = headers.cookies.as_deref().filter(|c| !c.is_empty()) {
        req = req.header(header::COOKIE, cookies);
    }
    req
}

pub fn validate_url(url: &str) -> Result<()> {
    match reqwest::Url::parse(url) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => Ok(()),
        Ok(u) => Err(Error::InvalidUrl(format!(
            "unsupported scheme '{}'",
            u.scheme()
        ))),
        Err(e) => Err(Error::InvalidUrl(e.to_string())),
    }
}

/// Ask for the first byte only: a `206` with `Content-Range` tells us both the
/// total size and that ranges work, without downloading the body.
pub async fn probe(client: &Client, url: &str, headers: &RequestHeaders) -> Result<ProbeResult> {
    validate_url(url)?;
    let mut resp = request(client, url, headers)
        .header(header::RANGE, "bytes=0-0")
        .send()
        .await?;
    // 416: typically an empty file. 400/403/405/501: some servers (and CDNs)
    // reject any Range header outright. Either way, retry as a plain GET and
    // download through a single connection.
    if matches!(resp.status().as_u16(), 400 | 403 | 405 | 416 | 501) {
        resp = request(client, url, headers).send().await?;
    }
    let status = resp.status();
    if !status.is_success() {
        return Err(status_error(&resp));
    }
    let h = resp.headers();
    let (total_size, resumable) = if status == StatusCode::PARTIAL_CONTENT {
        let total = content_range_total(h);
        (total, total.is_some())
    } else {
        (
            resp.content_length().filter(|_| has_content_length(h)),
            false,
        )
    };
    let server_name = h
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(naming::name_from_content_disposition);
    let final_url = resp.url().to_string();
    let name_from_server = server_name.is_some();
    let file_name = server_name.unwrap_or_else(|| naming::name_from_url(&final_url));

    Ok(ProbeResult {
        total_size,
        resumable,
        file_name,
        content_type: header_string(h, header::CONTENT_TYPE),
        final_url,
        etag: header_string(h, header::ETAG).filter(|e| !e.starts_with("W/")),
        last_modified: header_string(h, header::LAST_MODIFIED),
        name_from_server,
    })
}

/// Map a non-success response to an error, distinguishing "busy" responses
/// that are worth retrying with fewer connections.
pub fn status_error(resp: &reqwest::Response) -> Error {
    let status = resp.status().as_u16();
    match status {
        429 | 503 => Error::Busy {
            status,
            retry_after: resp
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse().ok()),
        },
        _ => Error::Status(status),
    }
}

fn header_string(h: &HeaderMap, name: header::HeaderName) -> Option<String> {
    h.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned)
}

fn has_content_length(h: &HeaderMap) -> bool {
    h.contains_key(header::CONTENT_LENGTH)
}

/// `Content-Range: bytes 0-0/12345` -> `Some(12345)`; `bytes 0-0/*` -> `None`.
pub fn content_range_total(h: &HeaderMap) -> Option<u64> {
    let v = h.get(header::CONTENT_RANGE)?.to_str().ok()?;
    v.rsplit('/').next()?.trim().parse().ok()
}

/// Start offset of a `Content-Range` header.
pub fn content_range_start(h: &HeaderMap) -> Option<u64> {
    let v = h.get(header::CONTENT_RANGE)?.to_str().ok()?;
    let range = v.trim().strip_prefix("bytes")?.trim();
    range.split('-').next()?.trim().parse().ok()
}
