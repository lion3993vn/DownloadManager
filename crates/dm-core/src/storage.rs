//! Positioned file writes so that many connections can fill one file.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

/// Open (or create) the `.dmpart` file. When `size` is known the file is
/// pre-sized so every segment can write at its own offset.
pub fn open_part_file(path: &Path, size: Option<u64>, truncate: bool) -> io::Result<File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let existed = path.exists();
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(truncate)
        .open(path)?;
    if !existed || truncate {
        // On NTFS writing far past the "valid data length" forces the OS to
        // zero-fill everything before it first; a sparse file avoids that stall.
        make_sparse(&file);
    }
    if let Some(size) = size {
        if file.metadata()?.len() != size {
            file.set_len(size)?;
        }
    }
    Ok(file)
}

pub fn write_all_at(file: &File, buf: &[u8], offset: u64) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset)
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let (mut buf, mut offset) = (buf, offset);
        while !buf.is_empty() {
            let n = file.seek_write(buf, offset)?;
            if n == 0 {
                return Err(io::ErrorKind::WriteZero.into());
            }
            buf = &buf[n..];
            offset += n as u64;
        }
        Ok(())
    }
}

#[cfg(windows)]
fn make_sparse(file: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    use windows_sys::Win32::System::IO::DeviceIoControl;
    let mut returned = 0u32;
    // Best effort: FAT/exFAT volumes do not support sparse files.
    unsafe {
        DeviceIoControl(
            file.as_raw_handle() as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        );
    }
}

#[cfg(not(windows))]
fn make_sparse(_file: &File) {
    // ext4/APFS/btrfs create sparse files on set_len already.
}

/// Folder next to the part file where an HLS download keeps its segments.
pub fn part_dir(part: &Path) -> std::path::PathBuf {
    let mut s = part.as_os_str().to_owned();
    s.push(".d");
    s.into()
}

/// Delete all partial data of a download: the part file and, for HLS, the
/// segment folder. Missing files are fine.
pub fn remove_part(part: &Path) {
    let _ = std::fs::remove_file(part);
    let _ = std::fs::remove_dir_all(part_dir(part));
}
