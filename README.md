# FeedSift

*A browser extension that sifts your Facebook and X feeds: it hides ads, videos, suggestions and Grok bait as you scroll, and can optionally score every remaining post against your interests with an LLM.*

FeedSift là extension Chrome (Manifest V3) lọc feed ngay khi bạn lướt Facebook và X. Quảng cáo, video, gợi ý và bài hỏi Grok bị ẩn theo quy tắc. Nếu muốn, một LLM do bạn tự cấu hình sẽ chấm điểm các bài còn lại theo sở thích để ẩn bài không đáng đọc.

- **Ẩn hẳn, không để lại dấu vết.** Bài bị ẩn biến mất khỏi feed, không có dòng "đã ẩn".
- **Không gửi request nào tới Facebook hay X.** Bộ lọc chỉ đọc và ẩn nội dung của trang bạn đang mở, nên không để lại dấu hiệu tự động ở phía họ.
- **Dữ liệu ở lại trình duyệt.** Cài đặt và điểm đã chấm nằm trong `chrome.storage.local` và IndexedDB. Chỉ khi bạn bật chấm điểm, nội dung chữ của các bài còn lại mới được gửi tới LLM bạn chọn (có thể chạy ngay trên máy).
- **Mỗi nền tảng một bộ cài đặt riêng,** có nhãn màu cho biết cài đặt nào áp dụng cho Facebook, cho X hay cho cả hai.

## Quy tắc ẩn

| Quy tắc | Facebook | X |
|---|---|---|
| Quảng cáo | ✓ nhãn "Được tài trợ" | ✓ nhãn "Ad", "Quảng cáo" |
| Video và reel | ✓ | ✓ (mặc định tắt) |
| Gợi ý kết bạn ("Những người bạn có thể biết") | ✓ | |
| Bài gợi ý ("Gợi ý cho bạn") | ✓ | |
| Trang chưa theo dõi (nút "Theo dõi" ở đầu bài) | ✓ | |
| Gợi ý nhóm (khối "Gợi ý nhóm" và bài từ nhóm chưa tham gia) | ✓ | |
| Bài hỏi Grok (tweet gọi `@grok` và câu trả lời của chính Grok) | | ✓ |
| Chấm điểm bằng LLM (tùy chọn) | ✓ dùng chung | ✓ dùng chung |

Các quy tắc chạy ngay khi bài xuất hiện, không cần LLM và không tốn token. Mỗi quy tắc bật tắt riêng và có hiệu lực ngay, không cần tải lại trang.

## Cài đặt

```bash
git clone https://github.com/namtao/feedsift.git
```

1. Mở `chrome://extensions` (hoặc `brave://extensions`) và bật **Developer mode**.
2. Bấm **Load unpacked** rồi chọn thư mục [extension/](extension/).
3. Bấm biểu tượng FeedSift để mở trang quản lý, bật các quy tắc muốn dùng, rồi mở facebook.com hoặc x.com.

Sau mỗi lần sửa code, bấm nút tải lại ở FeedSift rồi tải lại tab Facebook hoặc X.

## Cách dùng

Trang quản lý có thanh bên chia hai nhóm:

- **Bộ lọc khi lướt:** *Chung* (xám, áp dụng cho cả hai: chấm điểm bằng LLM, kết nối LLM, sở thích), *Facebook* (xanh) và *X* (đen). Mỗi nền tảng có công tắc bật lọc riêng và danh sách quy tắc riêng.
- **Quản lý Facebook** (xanh): Bạn bè, Trang, Nhóm, và Kết nối và an toàn.

Mỗi trang có tiêu đề kèm dòng "Chỉ áp dụng khi lướt facebook.com" hay "Áp dụng cho cả Facebook và X". Công tắc và ô số tự lưu ngay; chỉ các ô nhập chữ (URL, key, model, sở thích) cần bấm nút Lưu.

**Nút nhỏ ở góc dưới bên trái mỗi trang** cho biết "ẩn N/M bài". Rê chuột để xem đã ẩn những loại nào, bấm để tắt hoặc bật lọc của riêng nền tảng đó, bấm chuột phải để chép báo cáo chẩn đoán (cờ nhận ra, nút ở đầu bài và 100 ký tự đầu của 15 bài đầu; xem lại và xóa tên người trước khi gửi cho ai).

**Cầu chì:** nếu một quy tắc khớp hơn 60% số bài trên trang (khi đã có ít nhất 6 bài), extension coi là nhận diện sai, bỏ qua quy tắc đó và nút ở góc hiện ⚠. Đổi lại, một feed thật sự toàn quảng cáo hay toàn video sẽ không bị ẩn theo quy tắc ấy.

## Chấm điểm bằng LLM (tùy chọn)

Tắt ô "Chấm điểm và ẩn bài điểm thấp" thì không có lượt gọi LLM nào và không cần cấu hình gì thêm. Khi bật:

- Điền Base URL và model của bất kỳ API nào tương thích OpenAI (OmniRoute tại `http://localhost:20128`, OpenAI, OpenRouter, Ollama…); API key để trống được nếu router không yêu cầu. Nhập URL rồi bấm "Tải model": extension đọc `<URL>/v1/models` (hoặc `<URL>/models`) và gợi ý tên model khi gõ. Lần đầu dùng một địa chỉ mới, trình duyệt sẽ hỏi quyền truy cập địa chỉ đó.
- Điền ô Sở thích, cả điều bạn muốn đọc lẫn không muốn đọc. Càng cụ thể thì điểm càng sát: "AI: model mới, tool mã nguồn mở, kỹ thuật RAG/agent" tốt hơn chỉ ghi "AI".
- Mỗi bài còn lại sau các quy tắc được chấm 0–10; điểm hiện ở góc bài, bài dưới ngưỡng (mặc định 4) bị ẩn. Mặc định bài hiện ngay và chỉ ẩn khi có điểm; bật "Ẩn bài cho tới khi chấm xong" nếu muốn ngược lại.
- **Điểm được lưu đệm** theo nội dung bài và Sở thích, nên cuộn lại hay tải lại trang không gọi LLM lần nữa; sửa Sở thích thì chấm lại từ đầu.
- Nếu LLM lỗi hoặc quá 25 giây chưa có điểm, bài vẫn hiện bình thường và nút ở góc hiện ⚠.
- Nên chọn một model nhanh ở ô "Model dùng khi lọc", vì mỗi lần cuộn có vài bài cần chấm. Nên ghim một model cụ thể: combo tự rơi xuống model yếu hơn khi lỗi sẽ làm điểm dao động. Thang điểm nằm ở `SYSTEM_PROMPT` trong [extension/lib/scorer.js](extension/lib/scorer.js).

## Bạn bè, Trang, Nhóm (Facebook)

Bấm "Làm mới" để tải danh sách từ Facebook (vài giây với trang, khoảng một phút với bạn bè; với nhóm, extension còn đọc trạng thái theo dõi và thông báo của từng nhóm nên mất khoảng 5 giây mỗi nhóm), rồi lọc, xuất CSV và dọn danh sách:

| Mục | Nội dung | Lọc | Thao tác |
|---|---|---|---|
| Bạn bè | Ảnh, tên, trạng thái, bạn chung, giới tính | Chỉ tài khoản đã khóa, bạn chung ≤ N, giới tính | Hủy kết bạn |
| Trang | Ảnh, tên, loại trang, đã thích, xác minh | Loại trang | Bỏ theo dõi |
| Nhóm | Ảnh, tên, lần bạn vào cuối, bài mới nhất, quản trị, đã bỏ theo dõi, đã tắt thông báo | Không vào ≥ N ngày, không có bài mới ≥ N ngày | Rời nhóm, bỏ theo dõi, tắt thông báo |

Nút gạt "Thao tác" ở góc phải chọn giữa nút ngay trên từng dòng và chế độ chọn nhiều dòng rồi làm một lần.

- **Tài khoản đã khóa:** là bạn bè vẫn có trong danh sách trên trang cá nhân nhưng Facebook không trả về trong danh sách bạn bè đang hoạt động.
- **Thao tác dọn danh sách** chạy lần lượt, mỗi thao tác cách nhau 30–90 giây, tối đa 10 thao tác mỗi ngày cộng chung mọi mục, và tự dừng ở lỗi đầu tiên vì lỗi thường là do Facebook đang hạn chế tài khoản. Hủy kết bạn, bỏ theo dõi trang và rời nhóm không hoàn tác được. Bỏ theo dõi nhóm và tắt thông báo nhóm giữ nhóm trong danh sách và đánh dấu ✓; Facebook không cho biết trạng thái này khi tải danh sách nên cột chỉ ghi những gì đã làm từ trang quản lý.
- **Thời gian nghỉ:** khi Facebook trả HTTP 429, báo giới hạn tốc độ hay chặn tạm thời, hoặc chuyển sang trang xác minh (`/checkpoint`), extension dừng mọi thao tác với Facebook 24 giờ. Xử lý xong trên Facebook thì bấm "Bỏ thời gian nghỉ" ở mục "Kết nối và an toàn". Các mẫu nhận biết lỗi là suy đoán từ thông báo thường gặp, chưa kiểm chứng với mọi kiểu chặn của Facebook. Bộ lọc khi lướt không gửi request nên không bị ảnh hưởng.
- Các mục này gửi request tới Facebook bằng cookie của trình duyệt. Một rule `declarativeNetRequest` chỉ áp cho request của chính extension, đặt `Origin`/`Referer` thành `https://www.facebook.com`, vì API của Facebook từ chối origin `chrome-extension://`.

### doc_id của Facebook

Mỗi thao tác có tối đa ba nguồn `doc_id`, và mã mới nhất được thử trước. Nếu Facebook từ chối, extension thử mã tiếp theo:

1. **Tự học:** extension đọc các request GraphQL mà chính web Facebook gửi khi bạn lướt bình thường (`chrome.webRequest`), và lưu `doc_id` theo `fb_api_req_friendly_name`. Request do extension tự gửi thì không được học.
2. **Cấu hình từ xa:** file [extension/ops.json](extension/ops.json) được tải từ `remoteOpsUrl` khi khởi động và mỗi 6 giờ. Khi Facebook đổi mã một thao tác bạn ít khi tự làm (rời nhóm, hủy kết bạn…), chỉ cần sửa file này là mọi người dùng nhận mã mới, không cần phát hành bản mới. Mặc định URL trỏ tới [Gist public này](https://gist.github.com/namtao/e88f19c9790479f84d21da4392c896bd). Sau khi sửa `extension/ops.json` (nhớ đổi cả `updated`, vì mã mới nhất được thử trước), đẩy lên Gist bằng:

   ```bash
   gh gist edit e88f19c9790479f84d21da4392c896bd --filename ops.json extension/ops.json
   ```

   GitHub có thể cache link raw vài phút trước khi trả về bản mới.
3. **Kèm extension:** cũng là `extension/ops.json`, đóng gói lúc cài.

Trang quản lý hiển thị mã đang dùng của từng thao tác và nguồn của mã đó. Nếu một thao tác báo lỗi doc_id, hãy làm thao tác đó một lần bằng tay trên Facebook để extension tự học, hoặc bấm "Cập nhật cấu hình".

## Quyền của extension

| Quyền | Dùng để |
|---|---|
| Script trên `facebook.com`, `x.com`, `twitter.com` | Đọc và ẩn bài ngay trên trang |
| `storage` | Lưu cài đặt và danh sách bạn bè, trang, nhóm |
| `webRequest` | Học `doc_id` từ request của chính Facebook |
| `declarativeNetRequestWithHostAccess` | Đặt `Origin`/`Referer` cho request của extension tới Facebook |
| `alarms` | Làm mới cấu hình `doc_id` từ xa mỗi 6 giờ |
| Truy cập `*.facebook.com`, `gist.githubusercontent.com` | Các mục quản lý Facebook và tải cấu hình từ xa |
| Địa chỉ LLM của bạn (xin quyền khi bạn nhập URL) | Gọi API chấm điểm |

## Giới hạn

Các cách nhận diện dựa trên giao diện công khai của hai trang và có thể hỏng khi họ đổi giao diện. Quy tắc của Facebook đã dùng thử trên feed thật; quy tắc của X (quảng cáo, `@grok`, ô tweet trong danh sách ảo) mới kiểm thử trên trang dựng giả, chưa kiểm chứng với tài khoản X thật. Selector nằm ở đầu [extension/content/filter.js](extension/content/filter.js), phần `FACEBOOK` và `X`. Khi quy tắc không ẩn đúng, báo cáo chẩn đoán ở nút góc trang cho biết extension nhìn thấy gì.

## Cấu trúc

```
extension/
  manifest.json       quyền, content script, service worker
  content/filter.js   bộ lọc chạy trong trang Facebook và X (quy tắc, ẩn bài, nút ở góc)
  content/filter.css  ẩn bài và hiện điểm
  background.js       chấm điểm, danh sách Facebook, cài đặt
  manager.html/.js    trang quản lý
  lib/                settings, scorer (LLM), db (lưu đệm điểm), account + fb + ops (Facebook)
  ops.json            doc_id đi kèm
```

Cài đặt của các bản cũ được chuyển sang tên mới khi mở lần đầu. Điểm đã chấm nằm trong IndexedDB `fb-digest` (tên giữ nguyên từ các bản cũ để không mất điểm đã lưu).

## Giấy phép

[Apache-2.0](LICENSE)
