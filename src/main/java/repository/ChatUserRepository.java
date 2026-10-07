package repository;

import model.ChatUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ChatUserRepository extends JpaRepository<ChatUser, Long> {
    Optional<ChatUser> findByName(String name);
    Optional<ChatUser> findByIpAddress(String ipAddress);
    List<ChatUser> findByIsBanned(boolean isBanned);
    List<ChatUser> findByNameContainingIgnoreCase(String name);
    long countByIsBanned(boolean isBanned);
}
