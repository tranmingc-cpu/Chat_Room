package config;

import com.cloudinary.Cloudinary;
import com.cloudinary.utils.ObjectUtils;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

    @Configuration
    public class CloudinaryConfig {

        @Bean
        public Cloudinary cloudinary() {
            return new Cloudinary(ObjectUtils.asMap(
                    "cloud_name", "que3l9nf",
                    "api_key", "819963475572451",       // Thay bằng API Key
                    "api_secret", "EkI704-AhvV1_MXbsnSetrndbdw"   // Thay bằng API Secret
            ));
        }
    }

