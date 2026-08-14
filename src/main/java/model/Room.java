package model;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

public class Room {
    public enum UserStatus {
        PENDING,
        ACCEPTED,
        DECLINED
    }

    public static class ChatMessage {
        private String senderId;
        private String content;

        public ChatMessage(String senderId, String content) {
            this.senderId = senderId;
            this.content = content;
        }

        public String getSenderId() { return senderId; }
        public String getContent() { return content; }
    }

    private String roomId;
    private GuestSession user1;
    private GuestSession user2;
    private UserStatus user1Status;
    private UserStatus user2Status;
    
    // Lưu tạm tin nhắn của người vào trước trong lúc chờ người kia
    private List<ChatMessage> pendingMessages;

    public Room(GuestSession user1, GuestSession user2) {
        this.roomId = UUID.randomUUID().toString();
        this.user1 = user1;
        this.user2 = user2;
        this.user1Status = UserStatus.PENDING;
        this.user2Status = UserStatus.PENDING;
        this.pendingMessages = new CopyOnWriteArrayList<>();
    }

    public String getRoomId() {
        return roomId;
    }

    public GuestSession getUser1() {
        return user1;
    }

    public GuestSession getUser2() {
        return user2;
    }

    public UserStatus getUser1Status() {
        return user1Status;
    }

    public UserStatus getUser2Status() {
        return user2Status;
    }

    public void setUser1Status(UserStatus status) {
        this.user1Status = status;
    }

    public void setUser2Status(UserStatus status) {
        this.user2Status = status;
    }

    public void addPendingMessage(String senderId, String content) {
        this.pendingMessages.add(new ChatMessage(senderId, content));
    }

    public List<ChatMessage> getPendingMessages() {
        return pendingMessages;
    }

    public void clearPendingMessages() {
        this.pendingMessages.clear();
    }
    
    public boolean isBothAccepted() {
        return user1Status == UserStatus.ACCEPTED && user2Status == UserStatus.ACCEPTED;
    }
    
    public boolean isAnyDeclined() {
        return user1Status == UserStatus.DECLINED || user2Status == UserStatus.DECLINED;
    }
}
