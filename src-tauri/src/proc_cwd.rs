//! @description 进程 cwd 探测：经 macOS `PROC_PIDVNODEPATHINFO` 读取子进程当前工作目录。
//! 用于新标签/分屏继承目录与「复制当前路径」，是 OSC 7/1337 上报之外零配置的兜底通道
//! （Tabby 本地同款思路）。结构布局抄自 xnu `proc_info.h`（与 libproc crate 的
//! bindgen 输出一致，稳定 ABI），无需额外依赖。

/// xnu `vinfo_stat`
#[cfg(target_os = "macos")]
#[repr(C)]
#[allow(dead_code)]
struct VinfoStat {
    vst_dev: u32,
    vst_mode: u16,
    vst_nlink: u16,
    vst_ino: u64,
    vst_uid: u32,
    vst_gid: u32,
    vst_atime: i64,
    vst_atimensec: i64,
    vst_mtime: i64,
    vst_mtimensec: i64,
    vst_ctime: i64,
    vst_ctimensec: i64,
    vst_birthtime: i64,
    vst_birthtimensec: i64,
    vst_size: i64,
    vst_blocks: i64,
    vst_blksize: i32,
    vst_flags: u32,
    vst_gen: u32,
    vst_rdev: u32,
    vst_qspare: [i64; 2],
}

/// xnu `vnode_info`
#[cfg(target_os = "macos")]
#[repr(C)]
#[allow(dead_code)]
struct VnodeInfo {
    vi_stat: VinfoStat,
    vi_type: i32,
    vi_pad: i32,
    vi_fsid: [i32; 2],
}

/// xnu `vnode_info_path`；`path` 原为 `c_char[1024]`，按字节读取故声明为 `u8`
#[cfg(target_os = "macos")]
#[repr(C)]
struct VnodeInfoPath {
    vi: VnodeInfo,
    path: [u8; 1024],
}

/// xnu `proc_vnodepathinfo`：`cdir` 即进程当前工作目录
#[cfg(target_os = "macos")]
#[repr(C)]
struct ProcVnodePathInfo {
    cdir: VnodeInfoPath,
    #[allow(dead_code)]
    rdir: VnodeInfoPath,
}

#[cfg(target_os = "macos")]
const PROC_PIDVNODEPATHINFO: i32 = 9;

// proc_pidinfo 符号位于 libSystem，无需显式 #[link]
#[cfg(target_os = "macos")]
extern "C" {
    fn proc_pidinfo(
        pid: i32,
        flavor: i32,
        arg: u64,
        buffer: *mut core::ffi::c_void,
        buffersize: i32,
    ) -> i32;
}

/// 读取进程当前工作目录（macOS 进程探测）
///
/// # Arguments
///
/// * `pid` - 目标进程 id
///
/// # Returns
///
/// 工作目录绝对路径；进程不存在/已退出/权限不足时返回 `None`
///
/// # Examples
///
/// ```no_run
/// use scx_terminal_lib::proc_cwd::proc_cwd;
/// let cwd = proc_cwd(std::process::id() as i32);
/// assert!(cwd.is_some());
/// ```
#[cfg(target_os = "macos")]
pub fn proc_cwd(pid: i32) -> Option<String> {
    let mut info: ProcVnodePathInfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<ProcVnodePathInfo>() as i32;
    let ret = unsafe {
        proc_pidinfo(
            pid,
            PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut ProcVnodePathInfo as *mut core::ffi::c_void,
            size,
        )
    };
    if ret <= 0 {
        return None;
    }
    let path = &info.cdir.path;
    let len = path.iter().position(|&byte| byte == 0).unwrap_or(path.len());
    if len == 0 {
        return None;
    }
    Some(String::from_utf8_lossy(&path[..len]).into_owned())
}

/// 非 macOS 平台暂无进程探测通道，恒返回 `None`（OSC 7/1337 上报仍可用）
///
/// # Arguments
///
/// * `pid` - 目标进程 id
///
/// # Returns
///
/// 恒为 `None`
#[cfg(not(target_os = "macos"))]
pub fn proc_cwd(_pid: i32) -> Option<String> {
    None
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::proc_cwd;

    #[test]
    fn reports_own_process_cwd() {
        let cwd = proc_cwd(std::process::id() as i32);
        assert_eq!(cwd.as_deref(), std::env::current_dir().unwrap().to_str());
    }

    #[test]
    fn returns_none_for_missing_pid() {
        // macOS 默认 pid 上限 99999，取其外的值保证进程不存在
        assert!(proc_cwd(999_999).is_none());
    }
}
