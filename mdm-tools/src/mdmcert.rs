//! mdmcert.download signing requests (`mdmcert-download-request`).

use base64::Engine as _;

use crate::Error;

/// Base URL of the third-party signing service.
pub const MDMCERT_DOWNLOAD_BASE_URL: &str = "https://mdmcert.download";

/// Build the `{key, email, csr, encrypt}` JSON body with PEM values Base64-encoded.
pub fn build_sign_request_body(
    api_key: &str,
    email: &str,
    push_csr_pem: &str,
    server_cert_pem: &str,
) -> serde_json::Value {
    let engine = base64::engine::general_purpose::STANDARD;
    serde_json::json!({
        "key": api_key,
        "email": email,
        "csr": engine.encode(push_csr_pem.as_bytes()),
        "encrypt": engine.encode(server_cert_pem.as_bytes()),
    })
}

/// The Ruby script treats the request as successful only on HTTP 200 with
/// `{"result": "success"}`.
pub fn is_success_response(status: u16, body: &serde_json::Value) -> bool {
    status == 200 && body.get("result").and_then(serde_json::Value::as_str) == Some("success")
}

/// POST the signing request and return the user-facing success message.
///
/// Unlike the Ruby script — which builds the message string but drops it on
/// success, and silently exits zero on failure — this returns the message on
/// success and an error otherwise.
pub fn send_sign_request(
    base_url: &str,
    body: &serde_json::Value,
    email: &str,
) -> Result<String, Error> {
    let url = format!("{base_url}/api/v1/signrequest");
    let response = ureq::post(&url).send_json(body)?;
    let status = response.status().as_u16();
    let text = response.into_body().read_to_string()?;
    let parsed: serde_json::Value = serde_json::from_str(&text)?;
    if is_success_response(status, &parsed) {
        Ok(format!(
            "Email titled as 'do_not_reply' including .p7 will be sent to {email}."
        ))
    } else {
        Err(Error::SignRequestRejected { status, body: text })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn headers_end(request: &[u8]) -> Option<usize> {
        request
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|pos| pos + 4)
    }

    /// Serve one canned JSON response over plain HTTP; return the join handle
    /// and the base URL to point the client at.
    fn serve_once(status: u16, body: &'static str) -> (thread::JoinHandle<()>, String) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0, "client closed connection before sending headers");
                request.extend_from_slice(&buf[..n]);
                if let Some(end) = headers_end(&request) {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.trim()
                                .eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    assert!(length > 0, "expected a JSON request body");
                    let remaining = length.saturating_sub(request.len() - end);
                    if remaining > 0 {
                        let mut body = vec![0u8; remaining];
                        stream.read_exact(&mut body).unwrap();
                    }
                    break;
                }
            }
            let reason = if status == 200 { "OK" } else { "Bad Request" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (handle, base_url)
    }

    #[test]
    fn request_body_encodes_pem_values() {
        let body = build_sign_request_body("api-key", "user@example.com", "csr-pem", "cert-pem");
        assert_eq!(body["key"], "api-key");
        assert_eq!(body["email"], "user@example.com");
        let engine = base64::engine::general_purpose::STANDARD;
        assert_eq!(
            engine.decode(body["csr"].as_str().unwrap()).unwrap(),
            b"csr-pem"
        );
        assert_eq!(
            engine.decode(body["encrypt"].as_str().unwrap()).unwrap(),
            b"cert-pem"
        );
    }

    #[test]
    fn success_detection_matches_ruby_conditions() {
        assert!(is_success_response(
            200,
            &serde_json::json!({"result": "success"})
        ));
        assert!(!is_success_response(
            200,
            &serde_json::json!({"result": "error"})
        ));
        assert!(!is_success_response(200, &serde_json::json!({})));
        assert!(!is_success_response(
            500,
            &serde_json::json!({"result": "success"})
        ));
    }

    #[test]
    fn sends_request_and_reports_success() {
        let (handle, base_url) = serve_once(200, r#"{"result":"success"}"#);
        let body = build_sign_request_body("key", "user@example.com", "csr", "cert");
        let message = send_sign_request(&base_url, &body, "user@example.com").unwrap();
        assert!(message.contains("user@example.com"), "{message}");
        handle.join().unwrap();
    }

    #[test]
    fn rejects_failure_payload() {
        let (handle, base_url) = serve_once(200, r#"{"result":"error"}"#);
        let body = build_sign_request_body("key", "user@example.com", "csr", "cert");
        let error = send_sign_request(&base_url, &body, "user@example.com").unwrap_err();
        assert!(
            matches!(error, Error::SignRequestRejected { status: 200, .. }),
            "{error:?}"
        );
        handle.join().unwrap();
    }

    #[test]
    fn surfaces_http_errors() {
        let (handle, base_url) = serve_once(400, r#"{"result":"error"}"#);
        let body = build_sign_request_body("key", "user@example.com", "csr", "cert");
        let error = send_sign_request(&base_url, &body, "user@example.com").unwrap_err();
        assert!(
            matches!(error, Error::Http(_) | Error::SignRequestRejected { .. }),
            "{error:?}"
        );
        handle.join().unwrap();
    }
}
