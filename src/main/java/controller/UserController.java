package controller;

import model.ChatUser;
import repository.ChatUserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@RestController
public class UserController {

    private final ChatUserRepository chatUserRepository;

    public UserController(ChatUserRepository chatUserRepository) {

        this.chatUserRepository = chatUserRepository;
    }

    
    @PostMapping("/api/users/register")
    public ResponseEntity<ChatUser> registerOrUpdateUser(@RequestBody ChatUser userRequest) {
        ChatUser savedUser;
        if (userRequest.getId() != null) {
            Optional<ChatUser> existingUser = chatUserRepository.findById(userRequest.getId());
            if (existingUser.isPresent()) {
                ChatUser u = existingUser.get();
                if (userRequest.getName() != null && !userRequest.getName().isEmpty()) u.setName(userRequest.getName());
                if (userRequest.getAge() != null) u.setAge(userRequest.getAge());
                if (userRequest.getGender() != null) u.setGender(userRequest.getGender());
                if (userRequest.getLocation() != null) u.setLocation(userRequest.getLocation());
                if (userRequest.getAvatar() != null) u.setAvatar(userRequest.getAvatar());
                
                savedUser = chatUserRepository.save(u);
                return ResponseEntity.ok(savedUser);
            }
        }
        
        savedUser = chatUserRepository.save(userRequest);
        return ResponseEntity.ok(savedUser);
    }
    
    // Kiểm tra xem user có bị ban không (trước khi cho phép chat)
    @GetMapping("/api/users/{id}/check-ban")
    public ResponseEntity<Boolean> checkBan(@PathVariable Long id) {
        return chatUserRepository.findById(id)
                .map(user -> ResponseEntity.ok(user.isBanned()))
                .orElse(ResponseEntity.ok(false));
    }


    
    @GetMapping("/admin/api/users")
    public ResponseEntity<List<ChatUser>> getAllUsers() {
        return ResponseEntity.ok(chatUserRepository.findAll());
    }
    
    @GetMapping("/admin/api/users/count")
    public ResponseEntity<Long> countUsers() {
        return ResponseEntity.ok(chatUserRepository.count());
    }

    @PostMapping("/admin/api/users/{id}/ban")
    public ResponseEntity<Void> banUser(@PathVariable Long id, @RequestParam boolean banned) {
        Optional<ChatUser> userOpt = chatUserRepository.findById(id);
        if (userOpt.isPresent()) {
            ChatUser user = userOpt.get();
            user.setBanned(banned);
            chatUserRepository.save(user);
            return ResponseEntity.ok().build();
        }
        return ResponseEntity.notFound().build();
    }
    
    @DeleteMapping("/admin/api/users/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        if (chatUserRepository.existsById(id)) {
            chatUserRepository.deleteById(id);
            return ResponseEntity.ok().build();
        }
        return ResponseEntity.notFound().build();
    }
}
