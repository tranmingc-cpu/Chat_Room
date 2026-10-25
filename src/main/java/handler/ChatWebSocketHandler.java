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

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    // Map: roomId -> [user1Id, user2Id]
    private final Map<String, String[]> roomParticipants = new ConcurrentHashMap<>();

    // Map: sessionId -> Set of roomIds user is in
    private final Map<String, java.util.Set<String>> userRooms = new ConcurrentHashMap<>();

    public ChatWebSocketHandler(MatchingService matchingService) {
        this.matchingService = matchingService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.put(session.getId(), session);
        userRooms.put(session.getId(), ConcurrentHashMap.newKeySet());
        System.out.println("User kết nối: " + session.getId());
    }
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        Map<String, Object> data = objectMapper.readValue(payload, Map.class);
        String action = (String) data.get("action");
        String sessionId = session.getId();

        if ("FIND_MATCH".equals(action)) {
            java.util.Set<String> activeRooms = userRooms.getOrDefault(sessionId, Collections.emptySet());
            if (activeRooms.size() >= 5) {
                sendMessage(session, Map.of(
                        "type", "ERROR",
                        "message", "Bạn đã đạt tối đa 5 phòng chat đồng thời!"
                ));
                return;
            }
            Map<String, String> userInfo = (Map<String, String>) data.get("userInfo");
            matchingService.addToQueue(sessionId, userInfo != null ? userInfo : Map.of());
            tryMatch();
        } else if ("SEND_MSG".equals(action)) {
            String roomId = (String) data.get("roomId");
            String partnerId = getPartnerInRoom(roomId, sessionId);
            if (partnerId != null && sessions.containsKey(partnerId)) {
                WebSocketSession partnerSession = sessions.get(partnerId);

                Map<String, Object> response = Map.of(
                        "type", "CHAT",
                        "roomId", roomId,
                        "message", (String) data.get("message"),
                        "msgType", (String) data.getOrDefault("msgType", "text")
                );
                sendMessage(partnerSession, response);
            }
        } else if ("TYPING".equals(action)) {
            String roomId = (String) data.get("roomId");
            String partnerId = getPartnerInRoom(roomId, sessionId);
            if (partnerId != null && sessions.containsKey(partnerId)) {
                WebSocketSession partnerSession = sessions.get(partnerId);
                Map<String, Object> response = Map.of(
                        "type", "TYPING",
                        "roomId", roomId
                );
                sendMessage(partnerSession, response);
            }
        } else if ("LEAVE_ROOM".equals(action) || "SKIP".equals(action)) {
            String roomId = (String) data.get("roomId");
            if (roomId != null) {
                leaveRoom(roomId, sessionId);
            } else {
                java.util.Set<String> rooms = userRooms.get(sessionId);
                if (rooms != null && !rooms.isEmpty()) {
                    String firstRoom = rooms.iterator().next();
                    leaveRoom(firstRoom, sessionId);
                }
            }
        } else if ("CANCEL_MATCH".equals(action)) {
            matchingService.removeFromQueue(sessionId);
        }
    }

    private String getPartnerInRoom(String roomId, String sessionId) {
        if (roomId == null) return null;
        String[] participants = roomParticipants.get(roomId);
        if (participants != null) {
            if (sessionId.equals(participants[0])) return participants[1];
            if (sessionId.equals(participants[1])) return participants[0];
        }
        return null;
    }

    private void leaveRoom(String roomId, String sessionId) throws IOException {
        String partnerId = getPartnerInRoom(roomId, sessionId);
        roomParticipants.remove(roomId);

        java.util.Set<String> rooms = userRooms.get(sessionId);
        if (rooms != null) rooms.remove(roomId);

        if (partnerId != null) {
            java.util.Set<String> partnerRooms = userRooms.get(partnerId);
            if (partnerRooms != null) partnerRooms.remove(roomId);

            WebSocketSession partnerSession = sessions.get(partnerId);
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
        matchingService.removeFromQueue(sessionId);

        java.util.Set<String> rooms = userRooms.remove(sessionId);
        if (rooms != null) {
            for (String roomId : new java.util.ArrayList<>(rooms)) {
                leaveRoom(roomId, sessionId);
            }
        }
        sessions.remove(sessionId);
        System.out.println("User ngắt kết nối: " + sessionId);
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
            sendMessage(sessions.get(user1Id), msg1);

            Map<String, Object> msg2 = Map.of(
                    "type", "MATCHED",
                    "roomId", roomId,
                    "partnerInfo", matchingService.getUserInfo(user1Id)
            );
            sendMessage(sessions.get(user2Id), msg2);
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