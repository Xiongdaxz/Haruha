use std::{
    net::TcpListener,
    sync::mpsc::{self, Sender},
    thread::{self, JoinHandle},
    time::Duration,
};

use anyhow::{Context, Result};
use tiny_http::{Header, Response, Server};

pub struct PacServer {
    port: Option<u16>,
    shutdown: Option<Sender<()>>,
    handle: Option<JoinHandle<()>>,
}

impl PacServer {
    pub fn new() -> Self {
        Self {
            port: None,
            shutdown: None,
            handle: None,
        }
    }

    pub fn start(&mut self, content: String, preferred_port: u16) -> Result<String> {
        self.stop();

        let listener = TcpListener::bind(("127.0.0.1", preferred_port))
            .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
            .context("启动PAC本地HTTP服务失败")?;
        let port = listener.local_addr()?.port();
        let server = Server::from_listener(listener, None)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let (tx, rx) = mpsc::channel::<()>();

        let handle = thread::spawn(move || loop {
            if rx.try_recv().is_ok() {
                break;
            }

            match server.recv_timeout(Duration::from_millis(250)) {
                Ok(Some(request)) => {
                    let response = Response::from_string(content.clone())
                        .with_header(
                            Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"application/x-ns-proxy-autoconfig"[..],
                            )
                            .unwrap(),
                        )
                        .with_header(
                            Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap(),
                        );
                    let _ = request.respond(response);
                }
                Ok(None) => {}
                Err(_) => break,
            }
        });

        self.port = Some(port);
        self.shutdown = Some(tx);
        self.handle = Some(handle);

        Ok(format!("http://127.0.0.1:{port}/proxy.pac"))
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.port = None;
    }

    #[cfg(windows)]
    pub fn port(&self) -> Option<u16> {
        self.port
    }
}

impl Drop for PacServer {
    fn drop(&mut self) {
        self.stop();
    }
}
