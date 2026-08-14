package service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class MatchingService {

    private static final String QUEUE_KEY = "random_chat_queue";
    private final StringRedisTemplate redisTemplate;

    public MatchingService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    // Thêm user vào hàng chờ
    public void addToQueue(String sessionId) {
        redisTemplate.opsForList().rightPush(QUEUE_KEY, sessionId);
    }

    // Xóa user khỏi hàng chờ nếu họ ngắt kết nối
    public void removeFromQueue(String sessionId) {
        redisTemplate.opsForList().remove(QUEUE_KEY, 1, sessionId);
    }

    // Lấy cặp người dùng tiếp theo ra khỏi hàng chờ
    public String[] matchUsers() {
        Long size = redisTemplate.opsForList().size(QUEUE_KEY);
        if (size != null && size >= 2) {
            String user1 = redisTemplate.opsForList().leftPop(QUEUE_KEY);
            String user2 = redisTemplate.opsForList().leftPop(QUEUE_KEY);
            return new String[]{user1, user2};
        }
        return null; // Chưa đủ 2 người
    }

    // Tạo Room ID ngẫu nhiên
    public String createRoomId() {
        return "room_" + UUID.randomUUID().toString().substring(0, 8);
    }
}
