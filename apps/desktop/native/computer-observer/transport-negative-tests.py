"""Disposable real-descriptor tests; no AX request is ever sent."""
import os
import pathlib
import pty
import select
import socket
import subprocess
import sys
import unittest
import uuid

HELPER = os.environ["OBSERVER_HELPER"]
SCRATCH = pathlib.Path(os.environ["OBSERVER_SCRATCH"])


class TransportTests(unittest.TestCase):
    def reject(self, descriptor):
        result = subprocess.run([HELPER], stdin=descriptor, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=3, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")

    def test_python_fifo_handshake_and_eof(self):
        with subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE) as child:
            try:
                child.stdin.write(b'{"op":"hello"}\n')
                child.stdin.flush()
                readable, _, _ = select.select([child.stdout], [], [], 3)
                self.assertTrue(readable, 'Handshake I/O watchdog expired')
                self.assertEqual(os.read(child.stdout.fileno(), 4096), b'{"version":1,"ready":true}\n')
                out, err = child.communicate(b'bad\n', timeout=3)
                self.assertEqual(child.returncode, 0)
                self.assertIn(b'"INVALID_REQUEST"', out)
                self.assertEqual(err, b"")
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=3)

    def prequeued(self, payload, socket_input=False, close_input=False):
        if socket_input:
            reader, writer = socket.socketpair()
            writer.sendall(payload)
            if close_input:
                writer.shutdown(socket.SHUT_WR)
        else:
            read_fd, write_fd = os.pipe()
            reader = os.fdopen(read_fd, 'rb', buffering=0)
            writer = os.fdopen(write_fd, 'wb', buffering=0)
            writer.write(payload)
            if close_input:
                writer.close()
        try:
            self.reject(reader)
        finally:
            reader.close()
            writer.close()

    def test_fifo_buffered_command_before_ack(self):
        self.prequeued(b'{"op":"hello"}\nbad\n')

    def test_fifo_hello_command_close(self):
        self.prequeued(b'{"op":"hello"}\nbad\n', close_input=True)

    def test_socket_buffered_command_before_ack(self):
        self.prequeued(b'{"op":"hello"}\nbad\n', socket_input=True)

    def test_socket_hello_command_write_half_close(self):
        self.prequeued(b'{"op":"hello"}\nbad\n', socket_input=True, close_input=True)

    def test_command_queued_beyond_first_read(self):
        hello = b'{"op":"hello"}'
        payload = hello + b' ' * (4095 - len(hello)) + b'\nbad\n'
        for socket_input in (False, True):
            with self.subTest(socket_input=socket_input):
                self.prequeued(payload, socket_input=socket_input)

    def test_fifo_partial_hello_hangup(self):
        self.prequeued(b'{"op":"hel', close_input=True)

    def test_socket_partial_hello_hangup(self):
        self.prequeued(b'{"op":"hel', socket_input=True, close_input=True)

    def test_closed_fifo_output(self):
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        try:
            with subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=write_fd,
                                  stderr=subprocess.PIPE) as child:
                try:
                    child.stdin.write(b'{"op":"hello"}\n')
                    child.stdin.flush()
                    child.wait(timeout=3)
                    self.assertEqual(child.returncode, 1)
                    self.assertEqual(child.stderr.read(), b'')
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait(timeout=3)
        finally:
            os.close(write_fd)

    def test_closed_socket_output(self):
        left, right = socket.socketpair()
        right.close()
        try:
            with subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=left,
                                  stderr=subprocess.PIPE) as child:
                try:
                    child.stdin.write(b'{"op":"hello"}\n')
                    child.stdin.flush()
                    child.wait(timeout=3)
                    self.assertEqual(child.returncode, 1)
                    self.assertEqual(child.stderr.read(), b'')
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait(timeout=3)
        finally:
            left.close()

    def test_closed_output_after_ack(self):
        with subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE) as child:
            try:
                child.stdin.write(b'{"op":"hello"}\n')
                child.stdin.flush()
                readable, _, _ = select.select([child.stdout], [], [], 3)
                self.assertTrue(readable, 'Handshake I/O watchdog expired')
                self.assertEqual(os.read(child.stdout.fileno(), 4096), b'{"version":1,"ready":true}\n')
                child.stdout.close()
                child.stdin.write(b'bad\n')
                child.stdin.flush()
                child.wait(timeout=3)
                self.assertEqual(child.returncode, 1)
                self.assertEqual(child.stderr.read(), b'')
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=3)

    def test_real_handshake_deadline(self):
        # Native poll deadline smoke; no timing tolerance or performance claim.
        # The separate subprocess watchdog must not decide the helper's outcome.
        for payload in (b'', b'{"op":"hel'):
            with self.subTest(payload=payload):
                with subprocess.Popen([HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE) as child:
                    try:
                        child.stdin.write(payload)
                        child.stdin.flush()
                        child.wait(timeout=8)
                        self.assertEqual(child.returncode, 1)
                        self.assertEqual(child.stdout.read(), b'')
                        self.assertEqual(child.stderr.read(), b'')
                    finally:
                        if child.poll() is None:
                            child.kill()
                            child.wait(timeout=3)

    def test_file_and_stdout_direction(self):
        with open(os.devnull, "rb") as file:
            self.reject(file)
        read_fd, write_fd = os.pipe()
        try:
            self.reject(write_fd)
            result = subprocess.run([HELPER], stdout=read_fd,
                                    stderr=subprocess.PIPE, input=b'', timeout=3, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stderr, b'')
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_tty(self):
        master, slave = pty.openpty()
        try:
            self.reject(slave)
        finally:
            os.close(master)
            os.close(slave)

    def test_closed_descriptor(self):
        result = subprocess.run([HELPER], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, preexec_fn=lambda: os.close(0), timeout=3)
        self.assertEqual(result.returncode, 1)
        self.assertEqual((result.stdout, result.stderr), (b'', b''))

    def test_datagram(self):
        left, right = socket.socketpair(type=socket.SOCK_DGRAM)
        try:
            self.reject(left)
        finally:
            left.close()
            right.close()

    def test_peer_closed(self):
        left, right = socket.socketpair()
        right.close()
        try:
            self.reject(left)
        finally:
            left.close()

    def test_tcp_connected_and_listener(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            self.reject(listener)
            with socket.create_connection(listener.getsockname()) as client:
                accepted, _ = listener.accept()
                with accepted:
                    self.reject(client)
                    self.reject(accepted)

    def test_unix_named_connected_and_listener(self):
        # Caller-owned scratch only; removed after every inherited child exits.
        path = SCRATCH / ('ax-' + uuid.uuid4().hex[:8])
        try:
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(path.name)
                listener.listen(1)
                self.reject(listener)
                with socket.socket(socket.AF_UNIX) as client:
                    client.connect(path.name)
                    accepted, _ = listener.accept()
                    with accepted:
                        self.reject(client)
                        self.reject(accepted)
        finally:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    os.chdir(SCRATCH)
    unittest.main(argv=[sys.argv[0]])
