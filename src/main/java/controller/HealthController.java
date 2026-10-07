package controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @RequestMapping(
            value = "/health",
            method = {RequestMethod.GET, RequestMethod.HEAD}
    )
    public String health() {
        return "OK";
    }
}