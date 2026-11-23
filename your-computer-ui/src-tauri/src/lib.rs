mod disk_cache;
mod drives;
mod favorites;
mod fs_info;
mod fs_list;
mod fs_ops;
mod icons;
mod open_with;
mod ntfs_index;
mod recycle_bin;
mod search;
mod special;
mod tags;
mod vibrancy;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                disk_cache::init(dir);
            } else if let Ok(base) = std::env::var("LOCALAPPDATA")
                .or_else(|_| std::env::var("APPDATA"))
            {
                disk_cache::init(std::path::PathBuf::from(base).join("your-computer-ui"));
            }
            let db = favorites::init_db(app.handle())?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            drives::list_drives,
            fs_list::list_dir,
            icons::get_shell_icons,
            icons::get_shell_icon,
            fs_info::get_item_info,
            open_with::list_open_with,
            fs_ops::create_folder,
            fs_ops::create_file,
            fs_ops::rename_path,
            fs_ops::duplicate_path,
            fs_ops::move_path,
            fs_ops::copy_into,
            fs_ops::trash_path,
            recycle_bin::peek_recycle_bin,
            recycle_bin::list_recycle_bin,
            recycle_bin::restore_recycle_bin_item,
            recycle_bin::delete_recycle_bin_item,
            recycle_bin::empty_recycle_bin,
            fs_ops::compress_zip,
            fs_ops::open_path,
            fs_ops::open_in_terminal,
            fs_ops::reveal_in_explorer,
            fs_ops::pin_quick_access,
            fs_ops::share_path,
            fs_ops::open_with_picker,
            fs_ops::read_image_data_url,
            fs_ops::path_exists,
            fs_ops::read_text_file,
            fs_ops::write_text_file,
            fs_ops::read_file_base64,
            fs_ops::write_file_base64,
            fs_ops::pick_open_files,
            fs_ops::pick_save_file,
            fs_ops::print_html_document,
            fs_ops::open_ms_store_search,
            vibrancy::apply_window_acrylic,
            special::get_special_folder,
            special::list_recents,
            special::list_applications,
            special::get_local_ip,
            favorites::list_favorite_folders,
            favorites::create_favorite_folder,
            favorites::list_favorites,
            favorites::add_favorite,
            favorites::remove_favorite,
            favorites::rename_favorite_folder,
            favorites::delete_favorite_folder,
            tags::list_item_tags,
            tags::set_item_tag,
            tags::list_items_by_tag,
            search::search_drive,
            search::rebuild_search_index,
            search::search_index_status,
            search::list_search_volumes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
