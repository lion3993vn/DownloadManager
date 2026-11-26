// Download list, stats bar, segment bar, title bar and other small shell pieces.
import { defineMessages, plural } from "../define";

export default defineMessages({
  vi: {
    "shell.pause": "Tạm dừng",
    "shell.resume": "Tiếp tục",
    "shell.redownload": "Tải lại",
    "shell.openFile": "Mở tệp",
    "shell.openFolder": "Mở thư mục",
    "shell.more": "Thêm",
    "shell.notStarted": "Chưa bắt đầu",
    "shell.connections": "{n} luồng",

    "shell.currentSpeed": "Tốc độ hiện tại",
    "shell.downloading": "Đang tải",
    "shell.queuedSub": "+{n} chờ",
    "shell.completed": "Hoàn tất",
    "shell.downloaded": "Đã tải về",

    "shell.segment": "Đoạn {n}: {pct}%",

    "shell.expandSidebar": "Mở rộng thanh bên",
    "shell.collapseSidebar": "Thu gọn thanh bên",
    "shell.minimize": "Thu nhỏ",
    "shell.maximize": "Phóng to",
    "shell.restore": "Khôi phục",
  },
  en: {
    "shell.pause": "Pause",
    "shell.resume": "Resume",
    "shell.redownload": "Download again",
    "shell.openFile": "Open file",
    "shell.openFolder": "Open folder",
    "shell.more": "More",
    "shell.notStarted": "Not started",
    "shell.connections": ({ n }) => plural(n, "connection", "connections"),

    "shell.currentSpeed": "Current speed",
    "shell.downloading": "Downloading",
    "shell.queuedSub": "+{n} queued",
    "shell.completed": "Completed",
    "shell.downloaded": "Downloaded",

    "shell.segment": "Segment {n}: {pct}%",

    "shell.expandSidebar": "Expand sidebar",
    "shell.collapseSidebar": "Collapse sidebar",
    "shell.minimize": "Minimize",
    "shell.maximize": "Maximize",
    "shell.restore": "Restore",
  },
});
