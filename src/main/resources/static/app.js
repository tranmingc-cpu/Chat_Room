let socket = null;
let isMatched = false;
let currentUserId = localStorage.getItem('chatUserId');
if (!currentUserId) {
    let lastId = parseInt(localStorage.getItem('lastGlobalUserId') || '0', 10);
    currentUserId = (lastId + 1).toString();
    localStorage.setItem('lastGlobalUserId', currentUserId);
    localStorage.setItem('chatUserId', currentUserId);
}

//  Lấy thông tin người dùng từ Form HTML (gồm Avatar, Tên, Tuổi, Thành phố)
function getUserInfo() {
    return {
        id: currentUserId,
        avatar: document.getElementById("guest-avatar")?.value || "https://via.placeholder.com/150",
        name: document.getElementById("guest-name")?.value.trim() || "Người lạ",
        age: document.getElementById("guest-age")?.value || "N/A",
        location: document.getElementById("guest-location")?.value || "Không xác định",
        gender: document.getElementById("guest-gender")?.value || "khác"
    };
}

// quản lý kết nối WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    socket = new WebSocket(`${protocol}//${host}/chat`);

    socket.onopen = () => {
        updateStatus("Đã kết nối! Bấm 'Tìm Room' để bắt đầu.", "#28a745");
        const btnMatch = document.getElementById("btn-match");
        if (btnMatch) btnMatch.disabled = false;
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleServerEvent(data);
        } catch (err) {
            console.error("Lỗi parse tin nhắn từ server:", err);
        }
    };

    socket.onclose = () => {
        updateStatus("Mất kết nối Server. Đang thử lại...", "#dc3545");
        const btnMatch = document.getElementById("btn-match");
        if (btnMatch) btnMatch.disabled = false;
        setTimeout(connectWebSocket, 3000);
    };
}

// Xử lý các sự kiện phản hồi từ Server
function handleServerEvent(data) {
    switch (data.type) {
        case 'MATCHED':
            showModal(true);
            updateStatus("Tìm thấy room! Đang chờ bạn xác nhận...", "#ffc107");

            // Hiển thị thông tin đối phương: Avatar, Tên, Tuổi, Thành phố
            if (data.partnerInfo) {
                displayPartnerInfo(data.partnerInfo);
            }
            break;

        case 'CHAT':
            if (data.msgType && data.msgType !== 'text') {
                appendMediaMessage(data.message, data.msgType, "partner");
            } else {
                appendMessage(data.message, "partner");
            }
            break;

        case 'PARTNER_LEFT':
            isMatched = false;
            updateStatus("Người lạ đã thoát. Hãy tìm người mới...", "#ffc107");
            appendMessage("Đối phương đã rời cuộc trò chuyện.", "system");
            clearPartnerInfo();
            toggleChatInput(false);
            showFindRoomOverlay(true);
            break;

        default:
            console.log("Sự kiện chưa xác định:", data);
    }
}

// 4. Các chức năng điều khiển cuộc trò chuyện
function findMatch() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert("Chưa kết nối đến máy chủ. Vui lòng đợi trong giây lát!");
        return;
    }

    const userInfo = getUserInfo();

    // Gửi thông tin User cùng hành động FIND_MATCH
    socket.send(JSON.stringify({
        action: "FIND_MATCH",
        userInfo: userInfo
    }));

    updateStatus("Đang tìm kiếm room ngẫu nhiên...", "#ffc107");

    const btnMatch = document.getElementById("btn-match");
    const btnExit = document.getElementById("btn-exit");
    if (btnMatch) btnMatch.disabled = true;
    if (btnExit) btnExit.disabled = true;
}

function acceptMatch() {
    showModal(false);
    isMatched = true;

    socket.send(JSON.stringify({ action: "ACCEPT" }));

    updateStatus("Đã kết nối! Chúc hai bạn trò chuyện vui vẻ.", "#007bff");
    appendMessage("Cả hai đã đồng ý trò chuyện!", "system");
    toggleChatInput(true);
}

function rejectMatch() {
    showModal(false);
    isMatched = false;
    clearPartnerInfo();
    appendMessage("Bạn đã từ chối trò chuyện. Hãy tìm phòng mới...", "system");
    socket.send(JSON.stringify({ action: "SKIP" }));
    showFindRoomOverlay(true);
}

function exitAndFindNew() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ action: "SKIP" }));
    isMatched = false;
    clearPartnerInfo();
    appendMessage("Bạn đã thoát cuộc trò chuyện.", "system");
    toggleChatInput(false);
    showFindRoomOverlay(true);
}

function showFindRoomOverlay(show) {
    const overlay = document.getElementById("find-room-overlay");
    if (overlay) {
        if (show) overlay.classList.remove("hidden");
        else overlay.classList.add("hidden");
    }
}

function startFindMatch() {
    showFindRoomOverlay(false);
    findMatch();
}

function sendMessage() {
    const input = document.getElementById("msg-input");
    const msg = input.value.trim();
    if (msg !== "" && isMatched) {
        socket.send(JSON.stringify({ action: "SEND_MSG", message: msg, msgType: "text" }));
        appendMessage(msg, "me");
        input.value = "";
    }
}

// 5. Quản lý tải File & Media
async function uploadAndSendFile(event) {
    const file = event.target.files[0];
    if (!file || !isMatched) return;

    const formData = new FormData();
    formData.append("file", file);
    updateStatus("Đang tải file lên...", "#ffc107");

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            socket.send(JSON.stringify({
                action: "SEND_MSG",
                message: data.url,
                msgType: data.type
            }));
            appendMediaMessage(data.url, data.type, "me");
            updateStatus("Đã kết nối! Chúc hai bạn trò chuyện vui vẻ.", "#007bff");
        } else {
            alert("Tải file thất bại!");
        }
    } catch (err) {
        console.error(err);
        alert("Lỗi kết nối khi gửi file!");
    } finally {
        event.target.value = "";
    }
}

// 6. Hiển thị duy nhất Avatar, Tên, Tuổi, Thành phố của đối phương
function displayPartnerInfo(info) {
    const avatarEl = document.getElementById("partner-avatar");
    const nameEl = document.getElementById("partner-name");
    const ageEl = document.getElementById("partner-age");
    const locationEl = document.getElementById("partner-location");

    const defaultAvatar = "https://via.placeholder.com/150";

    if (avatarEl) avatarEl.src = info.avatar || defaultAvatar;
    if (nameEl) nameEl.innerText = info.name || "Người lạ";
    if (ageEl) ageEl.innerText = info.age ? `${info.age} tuổi` : "Chưa rõ tuổi";
    if (locationEl) locationEl.innerText = info.location || "Không xác định";
}

function clearPartnerInfo() {
    const avatarEl = document.getElementById("partner-avatar");
    const nameEl = document.getElementById("partner-name");
    const ageEl = document.getElementById("partner-age");
    const locationEl = document.getElementById("partner-location");

    if (avatarEl) avatarEl.src = "https://via.placeholder.com/150";
    if (nameEl) nameEl.innerText = "";
    if (ageEl) ageEl.innerText = "";
    if (locationEl) locationEl.innerText = "";
}

// 7. Cập nhật giao diện & DOM
function updateStatus(text, color) {
    const statusBox = document.getElementById("status");
    if (statusBox) {
        statusBox.innerText = text;
        statusBox.style.backgroundColor = color;
        statusBox.style.color = "#fff";
    }
}

function toggleChatInput(enable) {
    const btnExit = document.getElementById("btn-exit");
    const btnSend = document.getElementById("btn-send");
    const btnMatch = document.getElementById("btn-match");
    const msgInput = document.getElementById("msg-input");
    const btnFile = document.getElementById("btn-file");
    const menuExit = document.getElementById("menu-exit-room");

    if (btnExit) btnExit.disabled = !enable;
    if (btnSend) btnSend.disabled = !enable;
    if (btnMatch) btnMatch.disabled = enable;
    if (msgInput) msgInput.disabled = !enable;
    if (btnFile) btnFile.disabled = !enable;
    if (menuExit) menuExit.style.display = enable ? "flex" : "none";
}

function showModal(show) {
    const modal = document.getElementById("match-modal");
    if (modal) {
        if (show) modal.classList.remove("hidden");
        else modal.classList.add("hidden");
    }
}

function appendMediaMessage(url, type, sender) {
    const chatBox = document.getElementById("chat-box");
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${sender}`;

    if (type === 'image') {
        msgDiv.innerHTML = `<a href="${url}" target="_blank"><img src="${url}" alt="Hình ảnh" style="max-width:200px; border-radius:8px;" /></a>`;
    } else if (type === 'video') {
        msgDiv.innerHTML = `<video src="${url}" controls style="max-width:250px; border-radius:8px;"></video>`;
    }

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendMessage(msg, type) {
    const chatBox = document.getElementById("chat-box");
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${type}`;
    msgDiv.innerText = msg;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function handleKeyPress(e) {
    if (e.key === 'Enter') sendMessage();
}

// Xử lý upload avatar preview
async function uploadAvatarPreview(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            document.getElementById("guest-avatar").value = data.url;
        } else {
            alert("Tải ảnh thất bại!");
        }
    } catch (err) {
        console.error(err);
        alert("Lỗi tải ảnh!");
    } finally {
        event.target.value = "";
    }
}

// Mở modal hồ sơ
function openProfileModal() {
    const modal = document.getElementById("guest-modal");
    if (modal) {
        modal.classList.remove("hidden");
        const title = modal.querySelector("h3");
        if (title) title.innerText = "Hồ sơ của bạn";
        const btn = modal.querySelector(".btn-accept");
        if (btn) btn.innerText = "Lưu thông tin";
    }
}

// Lưu profile và đóng modal
function saveGuestProfile() {
    const modal = document.getElementById("guest-modal");
    if (modal) {
        modal.classList.add("hidden");
    }
    
    // Lưu thông tin vào localStorage để không bị mất khi F5
    const profile = {
        name: document.getElementById("guest-name")?.value.trim() || "",
        age: document.getElementById("guest-age")?.value || "",
        gender: document.getElementById("guest-gender")?.value || "khac",
        location: document.getElementById("guest-location")?.value || "",
        avatar: document.getElementById("guest-avatar")?.value || ""
    };
    localStorage.setItem("chatProfile", JSON.stringify(profile));
}

// 8. Tải danh sách tỉnh thành từ API
function loadProvinces() {
    const locationSelect = document.getElementById("guest-location");
    if (!locationSelect) return;

    fetch("https://provinces.open-api.vn/api/p/")
        .then(response => response.json())
        .then(data => {
            data.forEach(province => {
                const option = document.createElement("option");
                option.value = province.name;
                option.textContent = province.name;
                locationSelect.appendChild(option);
            });
            
            // Khôi phục location đã lưu
            try {
                const savedProfile = localStorage.getItem("chatProfile");
                if (savedProfile) {
                    const profile = JSON.parse(savedProfile);
                    if (profile.location) locationSelect.value = profile.location;
                }
            } catch(e) {}
        })
        .catch(error => {
            console.error("Lỗi khi load danh sách Tỉnh/Thành:", error);
        });
}

// 9. Khởi chạy khi trang web sẵn sàng
document.addEventListener("DOMContentLoaded", function () {
    const userIdEl = document.getElementById('user-id');
    if (userIdEl) userIdEl.innerText = currentUserId;

    // Khôi phục thông tin profile từ localStorage
    try {
        const savedProfile = localStorage.getItem("chatProfile");
        if (savedProfile) {
            const profile = JSON.parse(savedProfile);
            if (profile.name) document.getElementById("guest-name").value = profile.name;
            if (profile.age) document.getElementById("guest-age").value = profile.age;
            if (profile.gender) document.getElementById("guest-gender").value = profile.gender;
            if (profile.avatar) document.getElementById("guest-avatar").value = profile.avatar;
        }
    } catch(e) {}

    loadProvinces();
    connectWebSocket();
});

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active');
}
