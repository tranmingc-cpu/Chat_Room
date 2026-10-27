package service;

import model.GuestSession;
import model.Room;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Iterator;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

@Service
public class MatchmakingService {

    private final Queue<GuestSession> waitingQueue = new ConcurrentLinkedQueue<>();
    private final Map<String, Room> activeRooms = new ConcurrentHashMap<>();
    private final Map<String, String> userRoomMap = new ConcurrentHashMap<>();
    private final Map<String, Instant> matchHistory = new ConcurrentHashMap<>();
    private static final double COOLDOWN_HOURS = 1.5;
    private static final int FALLBACK_WAIT_SECONDS = 10;

    public Room matchOrQueue(GuestSession user) {
        if (userRoomMap.containsKey(user.getId())) {
            return null;
        }

        Room room = findStrictMatch(user);
        if (room != null) {
            return room;
        }

        if (!waitingQueue.contains(user)) {
            user.setEnqueuedTime(Instant.now());
            waitingQueue.offer(user);
        }
        return null;
    }

    private synchronized Room findStrictMatch(GuestSession user) {
        Iterator<GuestSession> iterator = waitingQueue.iterator();
        while (iterator.hasNext()) {
            GuestSession candidate = iterator.next();

            if (candidate.getClientId().equals(user.getClientId()))
                continue;
            if (userRoomMap.containsKey(candidate.getId())) {
                iterator.remove();
                continue;
            }
            if (hasMatchedRecently(user.getClientId(), candidate.getClientId()))
                continue;
            if (user.getGender() != null && candidate.getGender() != null &&
                    user.getGender().equalsIgnoreCase(candidate.getGender()))
                continue;
            if (user.getLocation() != null && candidate.getLocation() != null &&
                    user.getLocation().equalsIgnoreCase(candidate.getLocation())) {

                waitingQueue.remove(candidate);
                return createRoomAndRecordMatch(user, candidate);
            }
        }
        return null;
    }

    @Scheduled(fixedDelay = 5000)
    public synchronized void scheduledSweepQueue() {
        if (waitingQueue.size() < 2)
            return;
        Instant now = Instant.now();
        Iterator<GuestSession> iterator = waitingQueue.iterator();
        while (iterator.hasNext()) {
            GuestSession user = iterator.next();
            if (user.getEnqueuedTime() == null
                    || ChronoUnit.SECONDS.between(user.getEnqueuedTime(), now) < FALLBACK_WAIT_SECONDS) {
                continue;
            }
            GuestSession matchCandidate = findFallbackMatch(user);

            if (matchCandidate != null) {
                iterator.remove();
                waitingQueue.remove(matchCandidate);
                createRoomAndRecordMatch(user, matchCandidate);
            }
        }
    }

    private GuestSession findFallbackMatch(GuestSession user) {
        Instant now = Instant.now();
        for (GuestSession candidate : waitingQueue) {
            if (candidate.getId().equals(user.getId()))
                continue;
            if (candidate.getClientId().equals(user.getClientId()))
                continue;
            if (candidate.getEnqueuedTime() == null
                    || ChronoUnit.SECONDS.between(candidate.getEnqueuedTime(), now) < FALLBACK_WAIT_SECONDS) {
                continue;
            }

            if (userRoomMap.containsKey(candidate.getId()))
                continue;
            if (hasMatchedRecently(user.getClientId(), candidate.getClientId()))
                continue;
            if (user.getGender() != null && candidate.getGender() != null &&
                    user.getGender().equalsIgnoreCase(candidate.getGender()))
                continue;

            return candidate;
        }
        return null;
    }

    private Room createRoomAndRecordMatch(GuestSession user1, GuestSession user2) {
        Room room = new Room(user1, user2);
        activeRooms.put(room.getRoomId(), room);
        userRoomMap.put(user1.getId(), room.getRoomId());
        userRoomMap.put(user2.getId(), room.getRoomId());
        recordMatch(user1.getClientId(), user2.getClientId());
        return room;
    }

    public boolean acceptMatch(String sessionId) {
        String roomId = userRoomMap.get(sessionId);
        if (roomId == null)
            return false;

        Room room = activeRooms.get(roomId);
        if (room == null)
            return false;

        if (room.getUser1().getId().equals(sessionId)) {
            room.setUser1Status(Room.UserStatus.ACCEPTED);
        } else if (room.getUser2().getId().equals(sessionId)) {
            room.setUser2Status(Room.UserStatus.ACCEPTED);
        }
        return true;
    }

    public Room declineMatch(String sessionId) {
        String roomId = userRoomMap.get(sessionId);
        if (roomId == null)
            return null;

        Room room = activeRooms.remove(roomId);
        if (room == null)
            return null;

        if (room.getUser1().getId().equals(sessionId)) {
            room.setUser1Status(Room.UserStatus.DECLINED);
        } else if (room.getUser2().getId().equals(sessionId)) {
            room.setUser2Status(Room.UserStatus.DECLINED);
        }

        userRoomMap.remove(room.getUser1().getId());
        userRoomMap.remove(room.getUser2().getId());

        return room;
    }

    public Room getRoomBySessionId(String sessionId) {
        String roomId = userRoomMap.get(sessionId);
        return roomId != null ? activeRooms.get(roomId) : null;
    }

    public void leaveRoom(String sessionId) {
        String roomId = userRoomMap.get(sessionId);
        if (roomId != null) {
            Room room = activeRooms.remove(roomId);
            if (room != null) {
                userRoomMap.remove(room.getUser1().getId());
                userRoomMap.remove(room.getUser2().getId());
            }
        }
        waitingQueue.removeIf(u -> u.getId().equals(sessionId));
    }

    public void removeFromQueue(String sessionId) {
        waitingQueue.removeIf(u -> u.getId().equals(sessionId));
    }

    private void recordMatch(String clientId1, String clientId2) {
        String key = generateMatchKey(clientId1, clientId2);
        matchHistory.put(key, Instant.now());
    }

    private boolean hasMatchedRecently(String clientId1, String clientId2) {
        String key = generateMatchKey(clientId1, clientId2);
        Instant matchTime = matchHistory.get(key);
        if (matchTime == null)
            return false;

        long hoursElapsed = ChronoUnit.HOURS.between(matchTime, Instant.now());
        if (hoursElapsed < COOLDOWN_HOURS) {
            return true;
        } else {
            matchHistory.remove(key);
            return false;
        }
    }

    private String generateMatchKey(String id1, String id2) {
        return (id1.compareTo(id2) < 0) ? id1 + ":" + id2 : id2 + ":" + id1;
    }
}
