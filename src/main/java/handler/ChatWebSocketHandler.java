package handler;
import service.MatchingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final MatchingService matchingService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Lưu trữ tất cả các kết nối đang Online: Key = SessionId, Value = WebSocketSession
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    // Lưu thông tin phòng chat: Key = SessionId, Value = PartnerSessionId
    private final Map<String, String> userPartners = new ConcurrentHashMap<>();

    public ChatWebSocketHandler(MatchingService matchingService) {
        this.matchingService = matchingService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.put(session.getId(), session);
        System.out.println("User kết nối: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        Map<String, Object> data = objectMapper.readValue(payload, Map.class);
        String action = (String) data.get("action");

        if ("FIND_MATCH".equals(action)) {
            Map<String, String> userInfo = (Map<String, String>) data.get("userInfo");
            matchingService.addToQueue(session.getId(), userInfo != null ? userInfo : Map.of());
            tryMatch();
        } else if ("SEND_MSG".equals(action)) {
            String partnerId = userPartners.get(session.getId());
            if (partnerId != null && sessions.containsKey(partnerId)) {
                WebSocketSession partnerSession = sessions.get(partnerId);

                Map<String, String> response = Map.of(
                        "type", "CHAT",
                        "message", (String) data.get("message"),
                        "msgType", (String) data.getOrDefault("msgType", "text") // Lấy msgType (image/video/text)
                );
                partnerSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(response)));
            }
        } else if ("SKIP".equals(action)) {
            disconnectPartner(session.getId());
            Map<String, String> userInfo = (Map<String, String>) data.get("userInfo");
            if (userInfo != null) {
                matchingService.addToQueue(session.getId(), userInfo);
                tryMatch();
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = session.getId();
        matchingService.removeFromQueue(sessionId);
        disconnectPartner(sessionId);
        sessions.remove(sessionId);
        System.out.println("User ngắt kết nối: " + sessionId);
    }

    // Logic thử ghép đôi 2 người trong hàng chờ
    private synchronized void tryMatch() throws IOException {
        String[] matchedUsers = matchingService.matchUsers();
        if (matchedUsers != null) {
            String user1Id = matchedUsers[0];
            String user2Id = matchedUsers[1];

            userPartners.put(user1Id, user2Id);
            userPartners.put(user2Id, user1Id);

            String roomId = matchingService.createRoomId();

            // Thông báo cho User 1
            Map<String, Object> msg1 = Map.of("type", "MATCHED", "roomId", roomId, "partnerInfo", matchingService.getUserInfo(user2Id));
            sendMessage(sessions.get(user1Id), msg1);
            // Thông báo cho User 2
            Map<String, Object> msg2 = Map.of("type", "MATCHED", "roomId", roomId, "partnerInfo", matchingService.getUserInfo(user1Id));
            sendMessage(sessions.get(user2Id), msg2);
        }
    }

    private void disconnectPartner(String sessionId) throws IOException {
        String partnerId = userPartners.remove(sessionId);
        if (partnerId != null) {
            userPartners.remove(partnerId);
            WebSocketSession partnerSession = sessions.get(partnerId);
            if (partnerSession != null && partnerSession.isOpen()) {
                sendMessage(partnerSession, Map.of("type", "PARTNER_LEFT"));
            }
        }
    }

    private void sendMessage(WebSocketSession session, Map<String, Object> data) throws IOException {
        if (session != null && session.isOpen()) {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(data)));
        }
    }
}