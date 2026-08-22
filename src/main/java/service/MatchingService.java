package service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

@Service
public class MatchingService {

    private final Set<String> waitingPool = new CopyOnWriteArraySet<>();
    private final Map<String, String> userInfoMap = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MatchingService() {
    }

    // Thêm user vào hàng chờ
    public void addToQueue(String sessionId, Map<String, String> userInfo) {
        try {
            userInfoMap.put(sessionId, objectMapper.writeValueAsString(userInfo));
            waitingPool.add(sessionId);
        } catch (JsonProcessingException e) {
            e.printStackTrace();
        }
    }

    // Lấy thông tin user
    public Map<String, String> getUserInfo(String sessionId) {
        String info = userInfoMap.get(sessionId);
        if (info != null) {
            try {
                return objectMapper.readValue(info, new TypeReference<Map<String, String>>() {});
            } catch (JsonProcessingException e) {
                e.printStackTrace();
            }
        }
        return Collections.emptyMap();
    }

    // Xóa user khỏi hàng chờ
    public void removeFromQueue(String sessionId) {
        waitingPool.remove(sessionId);
        userInfoMap.remove(sessionId);
    }

    // Ghép đôi có điều kiện
    public String[] matchUsers() {
        if (waitingPool.size() < 2) {
            return null;
        }

        List<String> users = new ArrayList<>(waitingPool);
        List<Map<String, String>> infos = new ArrayList<>();
        
        for (String u : users) {
            infos.add(getUserInfo(u));
        }

        // Tìm cặp: 1. Khác giới, cùng location (ưu tiên cao)
        for (int i = 0; i < users.size(); i++) {
            for (int j = i + 1; j < users.size(); j++) {
                Map<String, String> info1 = infos.get(i);
                Map<String, String> info2 = infos.get(j);
                
                String gender1 = info1.getOrDefault("gender", "");
                String gender2 = info2.getOrDefault("gender", "");
                String loc1 = info1.getOrDefault("location", "");
                String loc2 = info2.getOrDefault("location", "");

                if (isOppositeGender(gender1, gender2) && loc1.equals(loc2) && !loc1.isEmpty()) {
                    return finalizeMatch(users.get(i), users.get(j));
                }
            }
        }

        // Tìm cặp: 2. Khác giới (ưu tiên thấp hơn)
        for (int i = 0; i < users.size(); i++) {
            for (int j = i + 1; j < users.size(); j++) {
                Map<String, String> info1 = infos.get(i);
                Map<String, String> info2 = infos.get(j);
                
                String gender1 = info1.getOrDefault("gender", "");
                String gender2 = info2.getOrDefault("gender", "");

                if (isOppositeGender(gender1, gender2)) {
                    return finalizeMatch(users.get(i), users.get(j));
                }
            }
        }

        return null;
    }

    private boolean isOppositeGender(String g1, String g2) {
        if ("nam".equalsIgnoreCase(g1) && "nu".equalsIgnoreCase(g2)) return true;
        if ("nu".equalsIgnoreCase(g1) && "nam".equalsIgnoreCase(g2)) return true;
        if ("khac".equalsIgnoreCase(g1) || "khac".equalsIgnoreCase(g2)) return true;
        return false;
    }

    private String[] finalizeMatch(String user1, String user2) {
        waitingPool.remove(user1);
        waitingPool.remove(user2);
        return new String[]{user1, user2};
    }

    // Tạo Room ID ngẫu nhiên
    public String createRoomId() {
        return "room_" + UUID.randomUUID().toString().substring(0, 8);
    }
}
