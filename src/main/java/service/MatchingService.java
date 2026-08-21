package service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class MatchingService {

    private static final String WAITING_POOL_KEY = "chat_waiting_pool";
    private static final String USER_INFO_PREFIX = "chat_user_info:";
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MatchingService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    // Thêm user vào hàng chờ
    public void addToQueue(String sessionId, Map<String, String> userInfo) {
        try {
            // Lưu userInfo
            redisTemplate.opsForValue().set(USER_INFO_PREFIX + sessionId, objectMapper.writeValueAsString(userInfo));
            // Đưa vào Set chờ
            redisTemplate.opsForSet().add(WAITING_POOL_KEY, sessionId);
        } catch (JsonProcessingException e) {
            e.printStackTrace();
        }
    }

    // Lấy thông tin user
    public Map<String, String> getUserInfo(String sessionId) {
        String info = redisTemplate.opsForValue().get(USER_INFO_PREFIX + sessionId);
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
        redisTemplate.opsForSet().remove(WAITING_POOL_KEY, sessionId);
        redisTemplate.delete(USER_INFO_PREFIX + sessionId);
    }

    // Ghép đôi có điều kiện
    public String[] matchUsers() {
        Set<String> waitingUsers = redisTemplate.opsForSet().members(WAITING_POOL_KEY);
        if (waitingUsers == null || waitingUsers.size() < 2) {
            return null;
        }

        List<String> users = new ArrayList<>(waitingUsers);
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
        // Nếu chọn "khac" (khác), match với ai cũng được (miễn là khác ID - đã lọc bởi 2 vòng lặp)
        if ("khac".equalsIgnoreCase(g1) || "khac".equalsIgnoreCase(g2)) return true;
        return false;
    }

    private String[] finalizeMatch(String user1, String user2) {
        redisTemplate.opsForSet().remove(WAITING_POOL_KEY, user1, user2);
        return new String[]{user1, user2};
    }

    // Tạo Room ID ngẫu nhiên
    public String createRoomId() {
        return "room_" + UUID.randomUUID().toString().substring(0, 8);
    }
}
