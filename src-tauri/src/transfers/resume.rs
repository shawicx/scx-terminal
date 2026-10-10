//! @description 断点续传纯逻辑：`.scxpart` 部分文件路径与续传偏移决策（源/部分文件
//!              大小比较），以及本地/远端部分文件的大小探测（pump 在执行计划前预扫
//!              断点、初始化聚合进度基数）。

use russh_sftp::client::SftpSession;

/// 部分文件后缀（传输完成前目标文件以该后缀落盘，完成后 rename 成正式名）
pub(crate) const PART_SUFFIX: &str = ".scxpart";

/**
 * @description 目标路径对应的部分文件路径（本地/远端通用）：在最后一段文件名前加 `.`、
 *              尾部加 `.scxpart`（点前缀使其默认隐藏，不污染双栏目录列表）
 * @param target 目标文件路径（下载=本地路径；上传=远端路径）
 * @returns String 部分文件路径
 *
 * @example assert_eq!(part_path("/srv/a.tar.gz"), "/srv/.a.tar.gz.scxpart")
 *
 */
pub(crate) fn part_path (target: &str) -> String {
    let sep = std::path::MAIN_SEPARATOR;
    match target.rfind(['/', sep]) {
        Some(idx) => format!("{}{}{}{}", &target[..idx + 1], ".", &target[idx + 1..], PART_SUFFIX),
        None => format!(".{target}{PART_SUFFIX}"),
    }
}

/// 续传决策：重传（从头）/ 续传（从 offset 起）/ 已完整（直接改名收尾）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResumeDecision {
    Restart,
    Continue(u64),
    Complete,
}

/**
 * @description 依据源文件大小与已存在部分文件大小决定续传策略：无部分文件或部分
 *              大小异常（> 源大小、源为空但部分非空）→ 重传；部分 == 源（源非空）
 *              → 已完整；部分 < 源 → 从部分大小偏移续传。源大小为 0 时恒为重传
 *              （空文件走「建空部分文件 → 0 拷贝 → rename」路径，避免陈旧部分文件污染）
 * @param source_size 源文件大小（plan 构建时统计）
 * @param part_size 已存在部分文件大小（None = 无部分文件）
 * @returns ResumeDecision
 *
 * @example assert_eq!(resume_offset(100, Some(40)), ResumeDecision::Continue(40));
 * @example assert_eq!(resume_offset(100, None), ResumeDecision::Restart);
 *
 */
pub(crate) fn resume_offset (source_size: u64, part_size: Option<u64>) -> ResumeDecision {
    match part_size {
        None => ResumeDecision::Restart,
        Some(part) if source_size > 0 && part == source_size => ResumeDecision::Complete,
        Some(part) if source_size > 0 && part < source_size => ResumeDecision::Continue(part),
        _ => ResumeDecision::Restart,
    }
}

/**
 * @description 探测本地部分文件大小（下载续传基数；不存在/非普通文件返回 None）
 * @param local_target 下载目标本地路径
 * @returns Option<u64> 部分文件字节数
 *
 * @example let part = local_part_size("/Users/scx/a.tar.gz").await
 *
 */
pub(crate) async fn local_part_size (local_target: &str) -> Option<u64> {
    let meta = tokio::fs::metadata(part_path(local_target)).await.ok()?;
    meta.is_file().then(|| meta.len())
}

/**
 * @description 探测远端部分文件大小（上传续传基数；不存在返回 None）
 * @param sftp SFTP 会话
 * @param remote_target 上传目标远端路径
 * @returns Option<u64> 部分文件字节数
 *
 * @example let part = remote_part_size(&sftp, "/srv/a.tar.gz").await
 *
 */
pub(crate) async fn remote_part_size (sftp: &SftpSession, remote_target: &str) -> Option<u64> {
    let meta = sftp.metadata(&part_path(remote_target)).await.ok()?;
    if meta.file_type().is_file() { meta.size } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part_path_appends_suffix () {
        assert_eq!(part_path("/srv/a.tar.gz"), "/srv/.a.tar.gz.scxpart");
        assert_eq!(part_path("/a.tar.gz"), "/.a.tar.gz.scxpart");
        assert_eq!(part_path("a.tar.gz"), ".a.tar.gz.scxpart");
    }

    #[test]
    fn resume_offset_branches () {
        // 无部分文件 → 重传
        assert_eq!(resume_offset(100, None), ResumeDecision::Restart);
        // 部分 < 源 → 续传
        assert_eq!(resume_offset(100, Some(40)), ResumeDecision::Continue(40));
        assert_eq!(resume_offset(100, Some(1)), ResumeDecision::Continue(1));
        // 部分 == 源（源非空）→ 已完整
        assert_eq!(resume_offset(100, Some(100)), ResumeDecision::Complete);
        // 部分 > 源（源已变化）→ 重传
        assert_eq!(resume_offset(100, Some(101)), ResumeDecision::Restart);
        // 源为空：无论部分如何恒重传（空文件走零拷贝 + rename 路径）
        assert_eq!(resume_offset(0, None), ResumeDecision::Restart);
        assert_eq!(resume_offset(0, Some(0)), ResumeDecision::Restart);
        assert_eq!(resume_offset(0, Some(5)), ResumeDecision::Restart);
    }
}
