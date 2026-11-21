//! Splitting a file into byte ranges.

/// Split `[0, total)` into at most `connections` contiguous ranges of at least
/// `min_segment` bytes (the last remainder byte(s) spread over the first ranges).
pub fn plan_segments(total: u64, connections: u32, min_segment: u64) -> Vec<(u64, u64)> {
    if total == 0 {
        return Vec::new();
    }
    let max_by_size = (total / min_segment.max(1)).max(1);
    let n = u64::from(connections.max(1)).min(max_by_size);
    let base = total / n;
    let rem = total % n;
    let mut start = 0;
    (0..n)
        .map(|i| {
            let len = base + u64::from(i < rem);
            let range = (start, start + len);
            start += len;
            range
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_contiguous(ranges: &[(u64, u64)], total: u64) {
        assert_eq!(ranges.first().unwrap().0, 0);
        assert_eq!(ranges.last().unwrap().1, total);
        for w in ranges.windows(2) {
            assert_eq!(w[0].1, w[1].0);
        }
    }

    #[test]
    fn even_split() {
        let r = plan_segments(100 * 1024 * 1024, 8, 1024 * 1024);
        assert_eq!(r.len(), 8);
        check_contiguous(&r, 100 * 1024 * 1024);
    }

    #[test]
    fn small_file_fewer_segments() {
        let r = plan_segments(3 * 1024 * 1024 + 5, 8, 1024 * 1024);
        assert_eq!(r.len(), 3);
        check_contiguous(&r, 3 * 1024 * 1024 + 5);
    }

    #[test]
    fn tiny_and_empty() {
        assert_eq!(plan_segments(10, 8, 1024), vec![(0, 10)]);
        assert!(plan_segments(0, 8, 1024).is_empty());
    }
}
