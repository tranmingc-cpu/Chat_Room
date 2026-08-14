package model;

import org.springframework.web.socket.WebSocketSession;
import java.time.Instant;

public class GuestSession {
    private String clientId; // ID cố định từ frontend để định danh (ngay cả khi F5)
    private String id;       // WebSocket Session ID (sẽ thay đổi khi F5)
    private WebSocketSession session;
    private String name;
    private int age;
    private String gender;
    private String location;
    
    // Lưu thời gian bắt đầu vào hàng đợi
    private Instant enqueuedTime;

    public GuestSession(String clientId, WebSocketSession session, String name, int age, String gender, String location) {
        this.clientId = clientId;
        this.id = session.getId();
        this.session = session;
        this.name = name;
        this.age = age;
        this.gender = gender;
        this.location = location != null ? location : "Toàn quốc";
        this.enqueuedTime = null;
    }

    // Getters và Setters
    public String getClientId() { return clientId; }
    public String getId() { return id; }
    public WebSocketSession getSession() { return session; }
    public String getName() { return name; }
    public int getAge() { return age; }
    public String getGender() { return gender; }
    public String getLocation() { return location; }
    
    public Instant getEnqueuedTime() { return enqueuedTime; }
    public void setEnqueuedTime(Instant enqueuedTime) { this.enqueuedTime = enqueuedTime; }
}