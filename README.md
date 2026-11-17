# Team Tracker – App đăng nhập cho team (tối đa 20 người)

App web theo dõi kế hoạch, nhắc việc, điểm thưởng và đổi quà. **Chỉ người được admin cấp tài khoản mới đăng nhập được.** Cả team dùng chung một dữ liệu trên máy chủ.

## 1. Chạy thử trên máy tính (Windows)

1. Cài **Node.js bản LTS** tại https://nodejs.org (chỉ cần làm một lần).
2. Giải nén thư mục `team-tracker-app`, bấm đúp **`CHAY-APP.bat`**.
3. Cửa sổ đen hiện **mật khẩu tạm của tài khoản `admin`**. Hãy ghi lại.
4. Trình duyệt mở `http://localhost:3000`. Đăng nhập `admin` + mật khẩu tạm, rồi đổi mật khẩu mới.

> Muốn tự đặt mật khẩu admin lần đầu: mở cửa sổ lệnh trong thư mục và chạy `set ADMIN_PASSWORD=MatKhauCuaAnh123 && node server.js`.

## 2. Cấp tài khoản cho nhân viên

Admin vào **👥 Người dùng** ở menu trái:

| Việc | Cách làm |
|---|---|
| Cấp tài khoản | Nhập tên đăng nhập (vd `lan.nguyen`), họ tên, chức danh, biểu tượng, quyền → **Cấp tài khoản**. Mật khẩu tạm hiện **một lần**, bấm **📋 Sao chép để gửi** rồi gửi riêng qua Zalo/Teams. |
| Lần đầu đăng nhập | Nhân viên **bắt buộc đổi mật khẩu** (≥ 8 ký tự, có chữ và số). |
| Quên mật khẩu | **🔑 Reset** → cấp mật khẩu tạm mới, phiên cũ bị đăng xuất. |
| Nghỉ việc / tạm ngưng | **🔒 Khóa** → không đăng nhập được, giữ nguyên lịch sử. |
| Thêm quản trị viên | **⬆️ Cho admin**. |

Giới hạn **20 tài khoản đang hoạt động** (tài khoản bị khóa không tính). Đổi giới hạn bằng biến `MAX_USERS`.

## 3. Ai được làm gì

| Chức năng | Nhân viên | Admin |
|---|---|---|
| Xem bảng việc, tổng quan, kế hoạch, bảng vàng | ✅ | ✅ |
| Cập nhật tiến độ / bấm "Xong" | Việc của mình | Mọi việc |
| Thêm việc | Cho chính mình | Cho bất kỳ ai |
| Xóa việc | Việc mình tạo | Mọi việc |
| Thưởng điểm, trao quà, thu hồi | ❌ | ✅ |
| Đổi quà, quay may mắn | Bằng điểm của mình | ✅ |
| Sửa tiêu đề, quản lý người dùng | ❌ | ✅ |

Luật điểm: xong việc **+20**, trễ hạn **−10**, cộng điểm thưởng của admin. Máy chủ tự kiểm tra số dư khi đổi quà.

## 4. Đưa lên cho cả team dùng

| Cách | Phù hợp | Ghi chú |
|---|---|---|
| **Máy chủ / máy tính trong mạng công ty** | Nhanh nhất | Chạy `CHAY-APP.bat` trên một máy luôn bật; nhân viên vào `http://<IP-máy>:3000`. Nhờ IT mở cổng 3000 trên tường lửa nội bộ. |
| **Azure App Service / máy chủ đám mây** | Truy cập từ xa | Bắt buộc dùng **HTTPS** và đặt `COOKIE_SECURE=1`. Ổ đĩa phải lưu bền thư mục `data/`. |
| **Nhúng vào SharePoint** | Xem trong trang SharePoint | Dùng khối Embed, đặt `FRAME_ANCESTORS="'self' https://<tencongty>.sharepoint.com"`; quản trị viên M365 phải cho phép tên miền. |

Biến môi trường khác: `PORT` (mặc định 3000), `SESSION_HOURS` (12), `TZ_APP` (Asia/Ho_Chi_Minh).

## 5. Sao lưu & bảo mật

- Toàn bộ dữ liệu nằm trong **`data/db.json`**. Sao lưu file này mỗi ngày (vd chép sang OneDrive/SharePoint).
- Mật khẩu được mã hóa một chiều (scrypt + salt), không ai đọc được mật khẩu gốc, kể cả admin.
- Sai mật khẩu 5 lần → khóa thử đăng nhập 15 phút. Phiên đăng nhập hết hạn sau 12 giờ.
- Có nhật ký thao tác (ai thêm/sửa/xóa gì) trong `db.json` → `audit`.
- Chỉ lưu thông tin công việc. **Không** đưa lương, sức khỏe, đánh giá cá nhân nhạy cảm lên app.
- Khi đưa ra Internet: luôn dùng HTTPS, đổi mật khẩu admin mạnh, giới hạn truy cập theo mạng công ty nếu được.

## 6. Cấu trúc thư mục

```
team-tracker-app/
├─ server.js        máy chủ: đăng nhập, phân quyền, lưu dữ liệu (không cần cài thư viện)
├─ public/login.html  trang đăng nhập + đổi mật khẩu lần đầu
├─ public/app.html    giao diện Team Tracker
├─ CHAY-APP.bat     bấm đúp để chạy trên Windows
└─ data/db.json     dữ liệu (tự tạo khi chạy lần đầu)
```
