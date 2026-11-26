// Settings dialog: components/SettingsDialog.tsx.
import { defineMessages } from "../define";

export default defineMessages({
  vi: {
    "settings.title": "Cài đặt",
    "settings.tab.download": "Tải xuống",
    "settings.tab.video": "Video",
    "settings.tab.browser": "Trình duyệt",
    "settings.tab.app": "Giao diện",
    "settings.tab.about": "Giới thiệu",

    "settings.downloadDir": "Thư mục lưu mặc định",
    "settings.browse": "Chọn…",
    "settings.connections": "Kết nối cho mỗi tệp",
    "settings.connectionsHint": "Số đoạn tải song song (1–32).",
    "settings.maxConcurrent": "Số tệp tải cùng lúc",
    "settings.maxConcurrentHint": "Các tệp còn lại sẽ xếp hàng chờ.",
    "settings.speedLimit": "Giới hạn tốc độ",
    "settings.speedLimitHint": "Áp dụng cho tổng tất cả lượt tải.",

    "settings.bridgeRunning": "Đang lắng nghe extension",
    "settings.bridgeStopped": "Cầu nối không chạy",
    "settings.bridgeLocal": "127.0.0.1:{port} — chỉ nhận kết nối từ máy này",
    "settings.installExtension": "Cài extension",
    "settings.confirmCaptures": "Hỏi trước khi tải",
    "settings.confirmCapturesHint": "Hiện hộp xác nhận khi bắt được tệp từ trình duyệt.",
    "settings.token": "Mã ghép cặp",
    "settings.tokenHint":
      "Extension cài từ app tự dùng mã này. Tạo mã mới sẽ ngắt kết nối các extension cũ cho tới khi chúng tự cập nhật.",
    "settings.newToken": "Tạo mã mới",

    "settings.language": "Ngôn ngữ",
    "settings.languageAuto": "Theo hệ thống",
    "settings.theme": "Chủ đề",
    "settings.themeSystem": "Theo hệ thống",
    "settings.themeLight": "Sáng",
    "settings.themeDark": "Tối",
    "settings.autostart": "Khởi động cùng hệ thống",
    "settings.autostartHint": "Tự chạy khi đăng nhập máy, ẩn dưới khay hệ thống để tiếp tục các lượt tải dở.",
    "settings.closeToTray": "Chạy nền khi đóng cửa sổ",
    "settings.closeToTrayHint": "Thu nhỏ xuống khay hệ thống để vẫn tải và bắt link từ trình duyệt.",

    "settings.version": "Phiên bản {version}",
    "settings.checkUpdates": "Kiểm tra cập nhật & xem có gì mới",
    "settings.aboutText":
      "Tải tệp nhanh hơn bằng cách chia nhỏ và tải song song nhiều đoạn. Hỗ trợ tạm dừng, tiếp tục sau khi tắt máy, và tự bắt lượt tải từ trình duyệt.",
  },
  en: {
    "settings.title": "Settings",
    "settings.tab.download": "Downloads",
    "settings.tab.video": "Video",
    "settings.tab.browser": "Browser",
    "settings.tab.app": "Appearance",
    "settings.tab.about": "About",

    "settings.downloadDir": "Default download folder",
    "settings.browse": "Browse…",
    "settings.connections": "Connections per file",
    "settings.connectionsHint": "Parallel segments per download (1–32).",
    "settings.maxConcurrent": "Simultaneous downloads",
    "settings.maxConcurrentHint": "Other files wait in the queue.",
    "settings.speedLimit": "Speed limit",
    "settings.speedLimitHint": "Applies to all downloads combined.",

    "settings.bridgeRunning": "Listening for the extension",
    "settings.bridgeStopped": "Bridge is not running",
    "settings.bridgeLocal": "127.0.0.1:{port} — accepts connections from this computer only",
    "settings.installExtension": "Install extension",
    "settings.confirmCaptures": "Ask before downloading",
    "settings.confirmCapturesHint": "Show a confirmation dialog when a file is captured from the browser.",
    "settings.token": "Pairing code",
    "settings.tokenHint":
      "Extensions installed from the app use this code automatically. A new code disconnects existing extensions until they update themselves.",
    "settings.newToken": "Generate new code",

    "settings.language": "Language",
    "settings.languageAuto": "System default",
    "settings.theme": "Theme",
    "settings.themeSystem": "System",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.autostart": "Start with the system",
    "settings.autostartHint": "Launch at login, hidden in the system tray, to resume unfinished downloads.",
    "settings.closeToTray": "Keep running when the window is closed",
    "settings.closeToTrayHint": "Minimize to the system tray to keep downloading and catching browser links.",

    "settings.version": "Version {version}",
    "settings.checkUpdates": "Check for updates & see what's new",
    "settings.aboutText":
      "Download files faster by splitting them into segments and fetching them in parallel. Pause, resume even after a restart, and catch downloads from your browser automatically.",
  },
});
