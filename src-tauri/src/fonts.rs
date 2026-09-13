//! 系统字体枚举：设置页字体选择器的数据源。

/// Lists all font family names available on the system, deduplicated and sorted.
#[tauri::command]
pub fn list_fonts() -> Vec<String> {
    let mut names = font_loader::system_fonts::query_all();
    names.sort_unstable();
    names.dedup();
    names
}
