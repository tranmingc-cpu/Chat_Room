package config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.beans.factory.annotation.Value;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests((requests) -> requests
                // Yêu cầu quyền ADMIN cho bất kỳ trang nào nằm trong thư mục /admin/
                .requestMatchers("/admin/**", "/admin.html").hasRole("ADMIN")
                // Cho phép tất cả các request khác (chat room) mà không cần đăng nhập
                .anyRequest().permitAll()
            )
            .formLogin((form) -> form
                // Sử dụng trang đăng nhập mặc định của Spring
                .permitAll()
            )
            .logout((logout) -> logout.permitAll())
            // Tắt CSRF tạm thời để không ảnh hưởng đến các tính năng API hiện tại
            .csrf(csrf -> csrf.disable());

        return http.build();
    }

    @Value("${ADMIN_PASSWORD:rinkito2005}")
    private String adminPassword;

    @Bean
    public UserDetailsService userDetailsService() {
        UserDetails admin = User.builder()
                .username("admin")
                .password("{noop}" + adminPassword) // Đọc mật khẩu từ biến môi trường
                .roles("ADMIN")
                .build();

        return new InMemoryUserDetailsManager(admin);
    }
}
