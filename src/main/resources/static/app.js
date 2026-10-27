let socket = null;
let isReconnecting = false;
let currentUserId = localStorage.getItem('chatUserId');
let clientUuid = localStorage.getItem('chatClientUuid');
if (!clientUuid) {
    clientUuid = 'c_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('chatClientUuid', clientUuid);
}
const MAX_ROOMS = 5;
let rooms = {};
let activeRoomId = null;
let pendingMatchData = null;
let isSearching = false;

function saveRoomsToStorage() {
    try {
        localStorage.setItem("activeChatRooms", JSON.stringify(rooms));
        if (activeRoomId) {
            localStorage.setItem("lastActiveRoomId", activeRoomId);
        } else {
            localStorage.removeItem("lastActiveRoomId");
        }
    } catch (e) {
        console.error("Lỗi lưu rooms vào localStorage:", e);
    }
}

function loadSavedRooms() {
    try {
        const savedRooms = localStorage.getItem("activeChatRooms");
        if (savedRooms) {
            rooms = JSON.parse(savedRooms) || {};
        }
        const lastActive = localStorage.getItem("lastActiveRoomId");
        if (lastActive && rooms[lastActive]) {
            activeRoomId = lastActive;
        } else {
            const roomIds = Object.keys(rooms);
            activeRoomId = roomIds.length > 0 ? roomIds[0] : null;
        }
    } catch (e) {
        console.error("Lỗi đọc rooms từ localStorage:", e);
        rooms = {};
        activeRoomId = null;
    }
}

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

let reconnectTimer = null;

function connectWebSocket() {
    if (
        socket &&
        (socket.readyState === WebSocket.CONNECTING ||
            socket.readyState === WebSocket.OPEN)
    ) {
        return;
    }
    const protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/chat`;
    console.log("Đang kết nối WebSocket:", url);
    try {
        socket = new WebSocket(url);
    } catch (err) {
        console.error("Không thể tạo WebSocket:", err);
        updateStatus("Mất kết nối Server. Đang thử lại...", "#dc3545");
        scheduleReconnect();
        return;
    }
    socket.onopen = () => {
        console.log("WebSocket đã kết nối thành công!");

        isReconnecting = false;
        clearTimeout(reconnectTimer);

        // Gửi định danh clientId cố định
        socket.send(JSON.stringify({
            action: "INIT",
            clientId: clientUuid
        }));

        // Khôi phục lại các room đang có trên server
        const activeRoomIds = Object.keys(rooms);
        if (activeRoomIds.length > 0) {
            socket.send(JSON.stringify({
                action: "REJOIN_ROOMS",
                roomIds: activeRoomIds
            }));
        }

        // Ẩn thanh status khi kết nối thành công/bình thường
        const statusBox = document.getElementById("status");
        if (statusBox) {
            statusBox.style.display = "none";
        }
        updateControlsState();
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleServerEvent(data);
        } catch (err) {
            console.error("Lỗi xử lý tin nhắn server:", err);
        }
    };

    socket.onerror = (event) => {
        console.error("WebSocket gặp lỗi:", event);
    };

    socket.onclose = (event) => {
        console.warn(
            "WebSocket đã đóng. Code:",
            event.code,
            "Lý do:",
            event.reason || "(không có)"
        );

        updateStatus(
            "Mất kết nối Server. Đang thử lại...",
            "#dc3545"
        );
        updateControlsState();
        scheduleReconnect();
    };
}

function scheduleReconnect() {
    if (isReconnecting) return;

    isReconnecting = true;

    reconnectTimer = setTimeout(() => {
        isReconnecting = false;
        connectWebSocket();
    }, 3000);
}

function handleServerEvent(data) {
    switch (data.type) {
        case 'MATCHED':
            isSearching = false;
            showLoadingOverlay(false);
            if (data.roomId) {
                const roomId = data.roomId;
                const partnerInfo = data.partnerInfo || {};
                const pName = partnerInfo.name || "Người lạ";
                const pAge = partnerInfo.age ? `${partnerInfo.age} tuổi` : "";
                const pLoc = partnerInfo.location || "";
                const extraInfo = [pAge, pLoc].filter(Boolean).join(" • ");
                const infoText = extraInfo ? ` (${extraInfo})` : "";

                rooms[roomId] = {
                    partnerInfo: partnerInfo,
                    messages: [
                        { kind: "match-banner", text: `Đã kết nối với ${pName}${infoText}! Hãy chào nhau nhé 👋` }
                    ],
                    unreadCount: 0
                };
                pendingMatchData = null;
                switchRoom(roomId);
            }
            renderRoomTabs();
            updateControlsState();
            break;

        case 'CHAT':
            onRoomMessageReceived(data.roomId, data.message, data.msgType || "text", "partner");
            break;

        case 'PARTNER_LEFT':
            onPartnerLeft(data.roomId);
            break;

        case 'ERROR':
            isSearching = false;
            showLoadingOverlay(false);
            renderRoomTabs();
            alert(data.message || "Đã xảy ra lỗi!");
            updateControlsState();
            break;

        default:
            console.log("Sự kiện chưa xác định:", data);
    }
}

async function findMatch() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert("Chưa kết nối đến máy chủ. Vui lòng đợi trong giây lát!");
        return;
    }

    // Nếu người dùng chưa có profile hoặc chưa nhập biệt danh, bắt buộc mở form thông tin trước
    if (!hasCompletedProfile()) {
        openProfileModal(true, () => {
            // Callback sau khi lưu form xong sẽ tự động tiếp tục tìm phòng
            findMatch();
        });
        return;
    }

    // Nếu đang tìm kiếm và người dùng bấm lại nút "Tìm thêm bạn", hủy tìm kiếm
    if (isSearching) {
        cancelSearch();
        return;
    }

    if (Object.keys(rooms).length >= MAX_ROOMS) {
        alert(`Bạn chỉ có thể trò chuyện tối đa ${MAX_ROOMS} phòng cùng lúc! Hãy đóng bớt 1 phòng để tìm phòng mới.`);
        return;
    }
    if (currentUserId) {
        try {
            const res = await fetch(`/api/users/${currentUserId}/check-ban`);
            const isBanned = await res.json();
            if (isBanned) {
                alert("Tài khoản của bạn đã bị cấm chat!");
                return;
            }
        } catch (e) {
        }
    }

    const userInfo = getUserInfo();

    socket.send(JSON.stringify({
        action: "FIND_MATCH",
        userInfo: userInfo
    }));

    isSearching = true;

    // Nếu chưa có phòng nào đang mở thì hiện modal tìm kiếm toàn màn hình,
    // còn nếu đã có ít nhất 1 phòng thì KHÔNG che màn hình, để người dùng vẫn chat bình thường!
    if (Object.keys(rooms).length === 0) {
        showLoadingOverlay(true);
    } else {
        showLoadingOverlay(false);
    }

    renderRoomTabs();
    updateControlsState();
}

function showLoadingOverlay(show) {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
        if (show) overlay.classList.remove("hidden");
        else overlay.classList.add("hidden");
    }
}

function cancelSearch() {
    isSearching = false;
    showLoadingOverlay(false);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({action: "CANCEL_MATCH"}));
    }
    renderRoomTabs();
    updateControlsState();
}

function acceptMatch() {
    showModal(false);
    isSearching = false;
    renderRoomTabs();
    if (!pendingMatchData) return;

    const roomId = pendingMatchData.roomId;
    const partnerInfo = pendingMatchData.partnerInfo || {};

    rooms[roomId] = {
        partnerInfo: partnerInfo,
        messages: [
            { kind: "system", text: "Cả hai đã đồng ý trò chuyện!" }
        ],
        unreadCount: 0
    };

    pendingMatchData = null;

    // Chuyển sang phòng vừa tạo
    switchRoom(roomId);
    saveRoomsToStorage();
    renderRoomTabs();
    updateControlsState();
}

function rejectMatch() {
    showModal(false);
    isSearching = false;
    renderRoomTabs();
    if (pendingMatchData) {
        socket.send(JSON.stringify({
            action: "SKIP",
            roomId: pendingMatchData.roomId
        }));
        pendingMatchData = null;
    }
    updateControlsState();
}

function exitAndFindNew() {
    if (!activeRoomId) return;
    leaveSpecificRoom(activeRoomId);
}

function leaveSpecificRoom(roomId) {
    if (!rooms[roomId]) return;

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            action: "LEAVE_ROOM",
            roomId: roomId
        }));
    }

    delete rooms[roomId];

    const remainingRoomIds = Object.keys(rooms);
    if (remainingRoomIds.length > 0) {
        switchRoom(remainingRoomIds[remainingRoomIds.length - 1]);
    } else {
        activeRoomId = null;
        clearPartnerInfo();
        clearChat();
        toggleChatInput(false);
        renderRoomTabs();
        showFindRoomOverlay(true);
    }
    saveRoomsToStorage();
    renderRoomTabs();
    updateControlsState();
}

function onPartnerLeft(roomId) {
    if (rooms[roomId]) {
        rooms[roomId].messages.push({
            kind: "system",
            text: "Người lạ đã rời khỏi phòng chat này."
        });

        if (activeRoomId === roomId) {
            appendMessage("Người lạ đã rời khỏi cuộc trò chuyện.", "system");
            updateStatus("Người lạ đã thoát khỏi phòng này.", "#dc3545");
        } else {
            rooms[roomId].unreadCount = (rooms[roomId].unreadCount || 0) + 1;
        }
        saveRoomsToStorage();
        renderRoomTabs();
    }
}

function switchRoom(roomId) {
    if (!rooms[roomId]) return;
    activeRoomId = roomId;
    rooms[roomId].unreadCount = 0; // Đã xem hết tin

    displayPartnerInfo(rooms[roomId].partnerInfo);
    renderChatBoxForActiveRoom();
    renderRoomTabs();
    toggleChatInput(true);

    const activeRoomTag = document.getElementById("active-room-tag");
    const indicator = document.getElementById("room-badge-indicator");
    if (indicator && activeRoomTag) {
        indicator.style.display = "block";
        const roomIndex = Object.keys(rooms).indexOf(roomId) + 1;
        activeRoomTag.innerText = `Phòng ${roomIndex}`;
    }

    saveRoomsToStorage();
    updateControlsState();
}

function renderRoomTabs() {
    const list = document.getElementById("room-tabs-list");
    if (!list) return;

    list.innerHTML = "";
    const roomIds = Object.keys(rooms);

    roomIds.forEach((rId, idx) => {
        const room = rooms[rId];
        const tab = document.createElement("div");
        tab.className = `room-tab ${rId === activeRoomId ? 'active' : ''}`;
        tab.onclick = () => switchRoom(rId);

        const avatarImg = document.createElement("img");
        avatarImg.className = "room-tab-avatar";
        avatarImg.src = room.partnerInfo.avatar || "https://via.placeholder.com/150";

        const titleSpan = document.createElement("span");
        titleSpan.className = "room-tab-title";
        titleSpan.innerText = room.partnerInfo.name ? `${idx + 1}. ${room.partnerInfo.name}` : `Room ${idx + 1}`;

        tab.appendChild(avatarImg);
        tab.appendChild(titleSpan);

        // Huy hiệu thông báo tin nhắn chưa đọc
        if (room.unreadCount && room.unreadCount > 0 && rId !== activeRoomId) {
            const badge = document.createElement("span");
            badge.className = "room-tab-badge";
            badge.innerText = room.unreadCount > 9 ? "9+" : room.unreadCount;
            tab.appendChild(badge);
        }

        // Nút đóng tab phòng chat: Cứ thế xóa trực tiếp, không cần confirm
        const closeBtn = document.createElement("button");
        closeBtn.className = "room-tab-close";
        closeBtn.innerHTML = "&times;";
        closeBtn.title = "Rời phòng chat này";
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            leaveSpecificRoom(rId);
        };
        tab.appendChild(closeBtn);

        list.appendChild(tab);
    });

    const addBtn = document.getElementById("btn-add-room");
    if (addBtn) {
        if (isSearching) {
            addBtn.disabled = false;
            addBtn.classList.add("searching");
            addBtn.title = "Đang tìm phòng... Bấm để hủy";
            addBtn.innerHTML = `
                <svg class="spin-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
                <span>Đang tìm...</span>
            `;
        } else {
            addBtn.classList.remove("searching");
            addBtn.disabled = roomIds.length >= MAX_ROOMS;
            addBtn.title = roomIds.length >= MAX_ROOMS 
                ? "Đã đạt tối đa 5 phòng chat đồng thời" 
                : `Tìm thêm bạn mới (${roomIds.length}/${MAX_ROOMS})`;
            addBtn.innerHTML = `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Tìm thêm bạn</span>
            `;
        }
    }

    const tabsContainer = document.getElementById("room-tabs-container");
    if (tabsContainer) {
        tabsContainer.style.display = roomIds.length > 0 ? "flex" : "none";
    }
}

function renderChatBoxForActiveRoom() {
    clearChat();
    if (!activeRoomId || !rooms[activeRoomId]) return;

    const partnerGender = rooms[activeRoomId]?.partnerInfo?.gender;
    const isFemalePartner = partnerGender === "nu" || partnerGender === "female";

    const msgs = rooms[activeRoomId].messages || [];
    msgs.forEach(m => {
        const isPartnerMsg = (m.sender === "partner");
        if (m.kind === "text" || m.kind === "system" || m.kind === "match-banner") {
            appendMessage(m.text, m.kind === "match-banner" ? "match-banner" : (m.sender || m.kind), isPartnerMsg && isFemalePartner);
        } else if (m.kind === "media") {
            appendMediaMessage(m.url, m.mediaType, m.sender, isPartnerMsg && isFemalePartner);
        }
    });
}

function onRoomMessageReceived(roomId, message, msgType, sender) {
    if (!rooms[roomId]) return;

    if (msgType === "text") {
        rooms[roomId].messages.push({ kind: "text", text: message, sender: sender });
    } else {
        rooms[roomId].messages.push({ kind: "media", url: message, mediaType: msgType, sender: sender });
    }

    if (roomId === activeRoomId) {
        const partnerGender = rooms[roomId]?.partnerInfo?.gender;
        const isFemalePartner = (partnerGender === "nu" || partnerGender === "female");

        if (msgType === "text") {
            appendMessage(message, sender, isFemalePartner);
        } else {
            appendMediaMessage(message, msgType, sender, isFemalePartner);
        }
    } else {
        rooms[roomId].unreadCount = (rooms[roomId].unreadCount || 0) + 1;
        renderRoomTabs();
    }
    saveRoomsToStorage();
}

function updateControlsState() {
    const btnMatch = document.getElementById("btn-match");
    const btnExit = document.getElementById("btn-exit");
    const isFull = Object.keys(rooms).length >= MAX_ROOMS;
    const isWsOpen = socket && socket.readyState === WebSocket.OPEN;

    if (btnMatch) {
        if (isSearching) {
            btnMatch.disabled = false;
            btnMatch.classList.add("searching");
            btnMatch.title = "Đang tìm phòng... Bấm để hủy";
            btnMatch.innerHTML = `
                <svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
                <span>Hủy tìm</span>
            `;
        } else {
            btnMatch.classList.remove("searching");
            btnMatch.disabled = !isWsOpen || isFull;
            btnMatch.title = isFull ? "Đã đạt tối đa phòng chat" : "Tìm kiếm phòng chat mới";
            btnMatch.innerHTML = `
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>Tìm phòng</span>
            `;
        }
    }
    if (btnExit) {
        btnExit.disabled = !activeRoomId;
    }
}

function showFindRoomOverlay(show) {
    const overlay = document.getElementById("find-room-overlay");
    if (overlay) {
        if (show) overlay.classList.remove("hidden");
        else overlay.classList.add("hidden");
    }
}

function closeFindRoomOverlay() {
    showFindRoomOverlay(false);
}

function startFindMatch() {
    showFindRoomOverlay(false);
    findMatch();
}

function sendMessage() {
    if (!activeRoomId || !rooms[activeRoomId]) return;
    const input = document.getElementById("msg-input");
    const msg = input.value.trim();
    if (msg !== "") {
        socket.send(JSON.stringify({
            action: "SEND_MSG",
            roomId: activeRoomId,
            message: msg,
            msgType: "text"
        }));
        rooms[activeRoomId].messages.push({ kind: "text", text: msg, sender: "me" });
        appendMessage(msg, "me");
        input.value = "";
        saveRoomsToStorage();
    }
}

async function uploadAndSendFile(event) {
    const file = event.target.files[0];
    if (!file || !activeRoomId || !rooms[activeRoomId]) return;

    const currentActive = activeRoomId;
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
                roomId: currentActive,
                message: data.url,
                msgType: data.type
            }));
            if (rooms[currentActive]) {
                rooms[currentActive].messages.push({
                    kind: "media",
                    url: data.url,
                    mediaType: data.type,
                    sender: "me"
                });
            }
            if (activeRoomId === currentActive) {
                appendMediaMessage(data.url, data.type, "me");
            }
            saveRoomsToStorage();
        }
    } catch (err) {
        console.error(err);
        alert("Lỗi kết nối khi gửi file!");
    } finally {
        event.target.value = "";
    }
}
function displayPartnerInfo(info) {
    const partnerCard = document.getElementById("partner-card");
    const avatarEl = document.getElementById("partner-avatar");
    const nameEl = document.getElementById("partner-name");
    const ageEl = document.getElementById("partner-age");
    const locationEl = document.getElementById("partner-location");

    if (partnerCard) partnerCard.style.display = "flex";

    const defaultAvatar = "https://via.placeholder.com/150";

    if (avatarEl) avatarEl.src = (info && info.avatar) || defaultAvatar;
    if (nameEl) nameEl.innerText = (info && info.name) || "Người lạ";
    if (ageEl) ageEl.innerText = (info && info.age) ? `${info.age} tuổi` : "Chưa rõ tuổi";
    if (locationEl) locationEl.innerText = (info && info.location) || "Không xác định";
}

function clearPartnerInfo() {
    const partnerCard = document.getElementById("partner-card");
    const avatarEl = document.getElementById("partner-avatar");
    const nameEl = document.getElementById("partner-name");
    const ageEl = document.getElementById("partner-age");
    const locationEl = document.getElementById("partner-location");
    const indicator = document.getElementById("room-badge-indicator");

    if (partnerCard) partnerCard.style.display = "none";
    if (avatarEl) avatarEl.src = "https://via.placeholder.com/150";
    if (nameEl) nameEl.innerText = "Chưa ghép đôi";
    if (ageEl) ageEl.innerText = "--";
    if (locationEl) locationEl.innerText = "--";
    if (indicator) indicator.style.display = "none";
}

function updateStatus(text, color) {
    const statusBox = document.getElementById("status");
    if (statusBox) {
        if (!text) {
            statusBox.style.display = "none";
            return;
        }
        statusBox.style.display = "block";
        statusBox.innerText = text;
        statusBox.style.backgroundColor = color || "#dc3545";
        statusBox.style.color = "#fff";
    }
}

function toggleChatInput(enable) {
    const btnExit = document.getElementById("btn-exit");
    const btnSend = document.getElementById("btn-send");
    const msgInput = document.getElementById("msg-input");
    const btnFile = document.getElementById("btn-file");
    const menuExit = document.getElementById("menu-exit-room");

    if (btnExit) btnExit.disabled = !enable;
    if (btnSend) btnSend.disabled = !enable;
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

    function appendMediaMessage(url, type, sender, isFemalePartner) {
        const chatBox = document.getElementById("chat-box");
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${sender}${isFemalePartner ? ' female' : ''}`;

        if (type === 'image') {
            msgDiv.innerHTML = `<img src="${url}" alt="Hình ảnh" style="max-width:200px; border-radius:8px; cursor:pointer;" onclick="openImageModal('${url}')" />`;
        } else if (type === 'video') {
            msgDiv.innerHTML = `<video src="${url}" controls style="max-width:250px; border-radius:8px;"></video>`;
        }

        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function appendMessage(msg, type, isFemalePartner) {
        const chatBox = document.getElementById("chat-box");
        const msgDiv = document.createElement("div");
        if (type === "match-banner") {
            msgDiv.className = "message-match-banner";
            msgDiv.innerHTML = `
                <div class="match-banner-badge">
                    <span class="match-banner-icon">✨</span>
                    <span class="match-banner-title">Ghép đôi thành công!</span>
                </div>
                <div class="match-banner-text">${msg}</div>
            `;
        } else {
            msgDiv.className = `message ${type}${isFemalePartner ? ' female' : ''}`;
            msgDiv.innerText = msg;
        }
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function clearChat() {
        const chatBox = document.getElementById("chat-box");
        if (chatBox) {
            const messages = chatBox.querySelectorAll('.message');
            messages.forEach(msg => msg.remove());
        }
    }
    function handleKeyPress(e) {
        if (e.key === 'Enter') sendMessage();
    }
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
                const avatarInput = document.getElementById("guest-avatar");
                if (avatarInput) avatarInput.value = data.url;
                const previewEl = document.getElementById("guest-avatar-preview");
                if (previewEl) previewEl.src = data.url;
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
    function updateUserProfileDisplay(profile) {
        const avatarEl = document.getElementById("my-avatar-display");
        const nameEl = document.getElementById("my-name-display");
        if (avatarEl) {
            avatarEl.src = profile.avatar || "https://via.placeholder.com/150";
        }
        if (nameEl) {
            nameEl.innerText = profile.name || "Người lạ";
        }
        if (profile.gender === "nu" || profile.gender === "female") {
            document.body.classList.add("theme-female");
        } else {
            document.body.classList.remove("theme-female");
        }
    }

    let profileSuccessCallback = null;

    function hasCompletedProfile() {
        try {
            const savedProfile = localStorage.getItem("chatProfile");
            if (savedProfile) {
                const profile = JSON.parse(savedProfile);
                if (profile && profile.name && profile.name.trim().length > 0 && profile.name.trim() !== "Người lạ") {
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function openProfileModal(isRequired = false, onSavedCallback = null) {
        profileSuccessCallback = onSavedCallback;
        const modal = document.getElementById("guest-modal");
        if (!modal) return;

        modal.classList.remove("hidden");
        const titleEl = document.getElementById("guest-modal-title");
        const subtitleEl = document.getElementById("guest-modal-subtitle");
        const submitBtn = document.getElementById("guest-submit-btn");
        const closeBtn = document.getElementById("btn-close-guest-modal");

        if (isRequired) {
            if (titleEl) titleEl.innerText = "👋 Bạn là người mới!";
            if (subtitleEl) subtitleEl.innerText = "Vui lòng nhập tên/biệt danh để bắt đầu tìm phòng chat:";
            if (submitBtn) submitBtn.innerText = "Lưu & Tiếp tục tìm bạn";
            if (closeBtn) {
                closeBtn.style.display = "flex";
                closeBtn.title = "Đóng";
            }
        } else {
            if (titleEl) titleEl.innerText = "Hồ sơ của bạn";
            if (subtitleEl) subtitleEl.innerText = "Cập nhật thông tin hiển thị với mọi người";
            if (submitBtn) submitBtn.innerText = "Lưu thay đổi";
            if (closeBtn) {
                closeBtn.style.display = "flex";
                closeBtn.title = "Đóng";
            }
        }

        const nameInput = document.getElementById("guest-name");
        if (nameInput) {
            setTimeout(() => nameInput.focus(), 150);
        }
    }

    function closeProfileModal() {
        const modal = document.getElementById("guest-modal");
        if (modal) {
            modal.classList.add("hidden");
        }
        profileSuccessCallback = null;
    }

    async function saveGuestProfileAndProceed() {
        const nameInput = document.getElementById("guest-name");
        const nameVal = nameInput ? nameInput.value.trim() : "";

        if (!nameVal) {
            alert("Vui lòng nhập Biệt danh / Tên hiển thị của bạn!");
            if (nameInput) nameInput.focus();
            return;
        }

        const profile = {
            name: nameVal,
            age: document.getElementById("guest-age")?.value.trim() || "",
            gender: document.getElementById("guest-gender")?.value || "khac",
            location: document.getElementById("guest-location")?.value || "",
            avatar: document.getElementById("guest-avatar")?.value.trim() || ""
        };

        if (currentUserId) {
            profile.id = currentUserId;
        }

        try {
            const response = await fetch('/api/users/register', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(profile)
            });

            if (response.ok) {
                const data = await response.json();
                currentUserId = data.id.toString();
                localStorage.setItem("chatUserId", currentUserId);
                const userIdEl = document.getElementById('user-id');
                if (userIdEl) userIdEl.innerText = currentUserId;
                if (data.banned) {
                    alert("Tài khoản của bạn đã bị cấm chat!");
                    return;
                }
            }
        } catch (e) {
            console.error("Lỗi đăng ký user:", e);
        }

        localStorage.setItem("chatProfile", JSON.stringify(profile));
        updateUserProfileDisplay(profile);

        const modal = document.getElementById("guest-modal");
        if (modal) {
            modal.classList.add("hidden");
        }

        const callback = profileSuccessCallback;
        profileSuccessCallback = null;
        if (typeof callback === 'function') {
            callback();
        }
    }

    // Giữ tương thích nếu có lời gọi cũ
    async function saveGuestProfile() {
        return saveGuestProfileAndProceed();
    }

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

                try {
                    const savedProfile = localStorage.getItem("chatProfile");
                    if (savedProfile) {
                        const profile = JSON.parse(savedProfile);
                        if (profile.location) locationSelect.value = profile.location;
                    }
                } catch (e) {
                }
            })
            .catch(error => {
                console.error("Lỗi khi load danh sách Tỉnh/Thành:", error);
            });
    }

    document.addEventListener("DOMContentLoaded", function () {
        const userIdEl = document.getElementById('user-id');
        if (userIdEl && currentUserId) {
            userIdEl.innerText = currentUserId;
        }

        let hasProfile = false;
        try {
            const savedProfile = localStorage.getItem("chatProfile");
            if (savedProfile) {
                const profile = JSON.parse(savedProfile);
                if (profile.name) {
                    document.getElementById("guest-name").value = profile.name;
                    hasProfile = true;
                }
                if (profile.age) document.getElementById("guest-age").value = profile.age;
                if (profile.gender) document.getElementById("guest-gender").value = profile.gender;
                if (profile.avatar) {
                    const avatarInput = document.getElementById("guest-avatar");
                    if (avatarInput) avatarInput.value = profile.avatar;
                    const previewEl = document.getElementById("guest-avatar-preview");
                    if (previewEl) previewEl.src = profile.avatar;
                }
                updateUserProfileDisplay(profile);
            }
        } catch (e) {
        }

        // Nếu là người dùng mới vào web lần đầu tiên (chưa có profile), hiển thị form nhập thông tin ngay
        if (!hasProfile) {
            setTimeout(() => {
                openProfileModal(true);
            }, 300);
        }

        const guestAvatarInput = document.getElementById("guest-avatar");
        if (guestAvatarInput) {
            guestAvatarInput.addEventListener("input", function (e) {
                const preview = document.getElementById("guest-avatar-preview");
                if (preview) {
                    preview.src = e.target.value || "https://via.placeholder.com/150";
                }
            });
        }

        // Khôi phục lại các phòng và tin nhắn đã lưu trước khi F5
        loadSavedRooms();
        if (Object.keys(rooms).length > 0) {
            renderRoomTabs();
            if (activeRoomId && rooms[activeRoomId]) {
                switchRoom(activeRoomId);
            }
        } else {
            clearPartnerInfo();
            renderRoomTabs();
        }

        loadProvinces();
        connectWebSocket();
    });

    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar-menu');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.toggle('active');
        if (overlay) overlay.classList.toggle('active');
    }

    function openImageModal(url) {
        let modal = document.getElementById('image-preview-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'image-preview-modal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.zIndex = '9999';
            modal.style.cursor = 'zoom-out';
            modal.onclick = function () {
                modal.style.display = 'none';
            };

            const img = document.createElement('img');
            img.id = 'image-preview-content';
            img.style.maxWidth = '90%';
            img.style.maxHeight = '90%';
            img.style.borderRadius = '8px';
            img.style.boxShadow = '0 8px 16px rgba(0,0,0,0.5)';
            img.style.objectFit = 'contain';

            const closeBtn = document.createElement('span');
            closeBtn.innerHTML = '&times;';
            closeBtn.style.position = 'absolute';
            closeBtn.style.top = '20px';
            closeBtn.style.right = '40px';
            closeBtn.style.color = '#fff';
            closeBtn.style.fontSize = '50px';
            closeBtn.style.fontWeight = 'bold';
            closeBtn.style.cursor = 'pointer';

            modal.appendChild(closeBtn);
            modal.appendChild(img);
            document.body.appendChild(modal);
        }

        document.getElementById('image-preview-content').src = url;
        modal.style.display = 'flex';
    }