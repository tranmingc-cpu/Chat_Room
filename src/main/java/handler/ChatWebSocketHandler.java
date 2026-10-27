package handler;
import service.MatchingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final MatchingService matchingService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Map: clientId -> WebSocketSession
    private final Map<String, WebSocketSession> clientSessions = new ConcurrentHashMap<>();

    // Map: sessionId -> clientId
    private final Map<String, String> sessionClientMap = new ConcurrentHashMap<>();

    // Map: roomId -> [clientId1, clientId2]
    private final Map<String, String[]> roomParticipants = new ConcurrentHashMap<>();

    // Map: clientId -> Set of roomIds user is in
    private final Map<String, java.util.Set<String>> userRooms = new ConcurrentHashMap<>();

    // Map: clientId -> TimerTask/Future for disconnection cleanup
    private final Map<String, java.util.concurrent.ScheduledFuture<?>> disconnectTimers = new ConcurrentHashMap<>();
    private final java.util.concurrent.ScheduledExecutorService scheduler = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();

    public ChatWebSocketHandler(MatchingService matchingService) {
        this.matchingService = matchingService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("WebSocket kết nối tạm thời: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        Map<String, Object> data = objectMapper.readValue(payload, Map.class);
        String action = (String) data.get("action");
        String sessionId = session.getId();

        if ("INIT".equals(action)) {
            String clientId = (String) data.get("clientId");
            if (clientId != null && !clientId.trim().isEmpty()) {
                sessionClientMap.put(sessionId, clientId);
                clientSessions.put(clientId, session);
                userRooms.computeIfAbsent(clientId, k -> ConcurrentHashMap.newKeySet());

                // Nếu có timer ngắt kết nối đang chờ, hủy đi vì user đã F5 quay lại kịp thời
                java.util.concurrent.ScheduledFuture<?> timer = disconnectTimers.remove(clientId);
                if (timer != null) {
                    timer.cancel(false);
                    System.out.println("User " + clientId + " đã kết nối lại (F5), hủy timer dọn phòng!");
                }
            }
            return;
        }

        // Lấy clientId của session này (fallback sang sessionId nếu chưa có)
        String clientId = sessionClientMap.getOrDefault(sessionId, sessionId);

        if ("REJOIN_ROOMS".equals(action)) {
            List<String> clientRoomIds = (List<String>) data.get("roomIds");
            if (clientRoomIds != null) {
                for (String rId : clientRoomIds) {
                    String[] participants = roomParticipants.get(rId);
                    if (participants != null && (clientId.equals(participants[0]) || clientId.equals(participants[1]))) {
                        userRooms.computeIfAbsent(clientId, k -> ConcurrentHashMap.newKeySet()).add(rId);
                    }
                }
            }
            return;
        }

        if ("FIND_MATCH".equals(action)) {
            java.util.Set<String> activeRooms = userRooms.getOrDefault(clientId, Collections.emptySet());
            if (activeRooms.size() >= 5) {
                sendMessage(session, Map.of(
                        "type", "ERROR",
                        "message", "Bạn đã đạt tối đa 5 phòng chat đồng thời!"
                ));
                return;
            }
            Map<String, String> userInfo = (Map<String, String>) data.get("userInfo");
            matchingService.addToQueue(clientId, userInfo != null ? userInfo : Map.of());
            tryMatch();
        } else if ("SEND_MSG".equals(action)) {
            String roomId = (String) data.get("roomId");
            String partnerId = getPartnerInRoom(roomId, clientId);
            if (partnerId != null && clientSessions.containsKey(partnerId)) {
                WebSocketSession partnerSession = clientSessions.get(partnerId);
                Map<String, Object> response = new HashMap<>();
                response.put("type", "CHAT");
                response.put("roomId", roomId);
                response.put("message", data.get("message"));
                response.put("msgType", data.getOrDefault("msgType", "text"));
                if (data.containsKey("msgId")) {
                    response.put("msgId", data.get("msgId"));
                }
                sendMessage(partnerSession, response);
            }
        } else if ("RECALL_MSG".equals(action)) {
            String roomId = (String) data.get("roomId");
            String msgId = (String) data.get("msgId");
            String partnerId = getPartnerInRoom(roomId, clientId);
            if (partnerId != null && clientSessions.containsKey(partnerId)) {
                WebSocketSession partnerSession = clientSessions.get(partnerId);
                Map<String, Object> response = Map.of(
                        "type", "RECALL_MSG",
                        "roomId", roomId,
                        "msgId", msgId != null ? msgId : ""
                );
                sendMessage(partnerSession, response);
            }
        } else if ("TYPING".equals(action)) {
            String roomId = (String) data.get("roomId");
            String partnerId = getPartnerInRoom(roomId, clientId);
            if (partnerId != null && clientSessions.containsKey(partnerId)) {
                WebSocketSession partnerSession = clientSessions.get(partnerId);
                Map<String, Object> response = Map.of(
                        "type", "TYPING",
                        "roomId", roomId
                );
                sendMessage(partnerSession, response);
            }
        } else if ("LEAVE_ROOM".equals(action) || "SKIP".equals(action)) {
            String roomId = (String) data.get("roomId");
            if (roomId != null) {
                leaveRoom(roomId, clientId);
            } else {
                java.util.Set<String> rooms = userRooms.get(clientId);
                if (rooms != null && !rooms.isEmpty()) {
                    String firstRoom = rooms.iterator().next();
                    leaveRoom(firstRoom, clientId);
                }
            }
        } else if ("CANCEL_MATCH".equals(action)) {
            matchingService.removeFromQueue(clientId);
        }
    }

    private String getPartnerInRoom(String roomId, String clientId) {
        if (roomId == null) return null;
        String[] participants = roomParticipants.get(roomId);
        if (participants != null) {
            if (clientId.equals(participants[0])) return participants[1];
            if (clientId.equals(participants[1])) return participants[0];
        }
        return null;
    }

    private void leaveRoom(String roomId, String clientId) throws IOException {
        String partnerId = getPartnerInRoom(roomId, clientId);
        roomParticipants.remove(roomId);

        java.util.Set<String> rooms = userRooms.get(clientId);
        if (rooms != null) rooms.remove(roomId);

        if (partnerId != null) {
            java.util.Set<String> partnerRooms = userRooms.get(partnerId);
            if (partnerRooms != null) partnerRooms.remove(roomId);

            WebSocketSession partnerSession = clientSessions.get(partnerId);
            if (partnerSession != null && partnerSession.isOpen()) {
                sendMessage(partnerSession, Map.of(
                        "type", "PARTNER_LEFT",
                        "roomId", roomId
                ));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = session.getId();
        String clientId = sessionClientMap.remove(sessionId);

        if (clientId != null) {
            matchingService.removeFromQueue(clientId);

            // Kiểm tra xem session vừa đóng có đúng là session đang lưu không
            WebSocketSession currentSession = clientSessions.get(clientId);
            if (currentSession != null && currentSession.getId().equals(sessionId)) {
                // Cho 60 giây grace period để user F5 hoặc tải lại trang mà không bị mất phòng
                java.util.concurrent.ScheduledFuture<?> future = scheduler.schedule(() -> {
                    try {
                        clientSessions.remove(clientId);
                        disconnectTimers.remove(clientId);
                        java.util.Set<String> rooms = userRooms.remove(clientId);
                        if (rooms != null) {
                            for (String roomId : new java.util.ArrayList<>(rooms)) {
                                leaveRoom(roomId, clientId);
                            }
                        }
                        System.out.println("Hết thời gian grace period (60s), dọn dẹp user " + clientId);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }, 60, java.util.concurrent.TimeUnit.SECONDS);

                disconnectTimers.put(clientId, future);
            }
        }
        System.out.println("WebSocket ngắt kết nối session: " + sessionId + " (client: " + clientId + ")");
    }
    private synchronized void tryMatch() throws IOException {
        String[] matchedUsers;
        while ((matchedUsers = matchingService.matchUsers()) != null) {
            String user1Id = matchedUsers[0];
            String user2Id = matchedUsers[1];

            String roomId = matchingService.createRoomId();
            roomParticipants.put(roomId, new String[]{user1Id, user2Id});

            userRooms.computeIfAbsent(user1Id, k -> ConcurrentHashMap.newKeySet()).add(roomId);
            userRooms.computeIfAbsent(user2Id, k -> ConcurrentHashMap.newKeySet()).add(roomId);

            Map<String, Object> msg1 = Map.of(
                    "type", "MATCHED",
                    "roomId", roomId,
                    "partnerInfo", matchingService.getUserInfo(user2Id)
            );
            sendMessage(clientSessions.get(user1Id), msg1);

            Map<String, Object> msg2 = Map.of(
                    "type", "MATCHED",
                    "roomId", roomId,
                    "partnerInfo", matchingService.getUserInfo(user1Id)
            );
            sendMessage(clientSessions.get(user2Id), msg2);
        }
    }

    private void sendMessage(WebSocketSession session, Map<String, Object> data) {
        if (session != null && session.isOpen()) {
            try {
                session.sendMessage(new TextMessage(objectMapper.writeValueAsString(data)));
            } catch (Exception e) {
                System.err.println("Không thể gửi tin nhắn đến session: " + e.getMessage());
            }
        }
    }
}