/* ============================================
   YouTube Shell — TOTP Authentication (Google Authenticator)
   Pure JS implementation using Web Crypto API
   ============================================ */

const YTAuth = (() => {
    'use strict';

    // ─── TOTP Secret ───────────────────────────────
    // Change this to your own Base32 secret!
    // Add this same key to Google Authenticator manually or via QR code.
    const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

    // Session duration: 30 days (in milliseconds)
    const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
    const SESSION_KEY = 'yt_auth_session';
    const TOTP_STEP = 30; // 30-second window
    const TOTP_DIGITS = 6;

    // ─── Base32 Decode ─────────────────────────────
    function base32Decode(encoded) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        encoded = encoded.replace(/=+$/, '').toUpperCase();

        let bits = '';
        for (const char of encoded) {
            const val = alphabet.indexOf(char);
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }

        const bytes = new Uint8Array(Math.floor(bits.length / 8));
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
        }
        return bytes;
    }

    // ─── Int to Bytes (8 bytes, big-endian) ────────
    function intToBytes(num) {
        const bytes = new Uint8Array(8);
        for (let i = 7; i >= 0; i--) {
            bytes[i] = num & 0xff;
            num = Math.floor(num / 256);
        }
        return bytes;
    }

    // ─── Generate TOTP ─────────────────────────────
    async function generateTOTP(secret, time) {
        const key = base32Decode(secret);
        const counter = Math.floor(time / 1000 / TOTP_STEP);
        const counterBytes = intToBytes(counter);

        // Import key for HMAC-SHA1
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );

        // Sign the counter
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
        const hmac = new Uint8Array(signature);

        // Dynamic truncation
        const offset = hmac[hmac.length - 1] & 0x0f;
        const binary =
            ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff);

        const otp = binary % Math.pow(10, TOTP_DIGITS);
        return otp.toString().padStart(TOTP_DIGITS, '0');
    }

    // ─── Verify TOTP ───────────────────────────────
    // Check current window + 1 before and 1 after (to handle clock drift)
    async function verifyTOTP(inputCode) {
        const now = Date.now();
        const windows = [-1, 0, 1]; // Check ±30 seconds

        for (const offset of windows) {
            const time = now + (offset * TOTP_STEP * 1000);
            const expected = await generateTOTP(TOTP_SECRET, time);
            if (inputCode === expected) {
                return true;
            }
        }
        return false;
    }

    // ─── Session Management ────────────────────────
    function createSession() {
        const session = {
            token: crypto.randomUUID(),
            created: Date.now(),
            expires: Date.now() + SESSION_DURATION_MS
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        // Also set a cookie for extra persistence
        const expDate = new Date(session.expires).toUTCString();
        document.cookie = `yt_auth=${session.token}; expires=${expDate}; path=/; SameSite=Strict`;
        return session;
    }

    function getSession() {
        try {
            const data = localStorage.getItem(SESSION_KEY);
            if (!data) return null;
            const session = JSON.parse(data);
            if (Date.now() > session.expires) {
                clearSession();
                return null;
            }
            return session;
        } catch {
            return null;
        }
    }

    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
        document.cookie = 'yt_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    }

    function isLoggedIn() {
        return getSession() !== null;
    }

    // ─── Login Handler ─────────────────────────────
    async function attemptLogin(code) {
        const trimmed = code.trim().replace(/\s/g, '');
        if (trimmed.length !== TOTP_DIGITS) {
            return { success: false, error: 'Inserisci il codice a 6 cifre' };
        }

        const valid = await verifyTOTP(trimmed);
        if (valid) {
            createSession();
            return { success: true };
        } else {
            return { success: false, error: 'Codice non valido. Riprova.' };
        }
    }

    // ─── UI Controller ─────────────────────────────
    function init() {
        const gate = document.getElementById('loginGate');
        const passwordInput = document.getElementById('loginPassword');
        const loginBtn = document.getElementById('loginBtn');
        const loginError = document.getElementById('loginError');

        if (!gate) return;

        // Already logged in? Skip gate
        if (isLoggedIn()) {
            gate.classList.add('hidden');
            document.body.classList.remove('yt-locked');
            return;
        }

        // Show gate, lock body
        document.body.classList.add('yt-locked');
        gate.classList.remove('hidden');

        async function handleLogin() {
            const code = passwordInput.value;
            loginBtn.disabled = true;
            loginBtn.textContent = 'Verifico...';
            loginError.textContent = '';

            const result = await attemptLogin(code);

            if (result.success) {
                gate.style.transition = 'opacity 0.3s ease';
                gate.style.opacity = '0';
                setTimeout(() => {
                    gate.classList.add('hidden');
                    document.body.classList.remove('yt-locked');
                    gate.style.opacity = '';
                }, 300);
            } else {
                loginError.textContent = result.error;
                loginBtn.disabled = false;
                loginBtn.textContent = 'Accedi';
                passwordInput.value = '';
                passwordInput.focus();

                // Shake animation
                passwordInput.style.animation = 'ytShake 0.4s ease';
                setTimeout(() => passwordInput.style.animation = '', 400);
            }
        }

        loginBtn.addEventListener('click', handleLogin);
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLogin();
            }
        });

        // Auto-format: only allow digits
        passwordInput.addEventListener('input', () => {
            passwordInput.value = passwordInput.value.replace(/\D/g, '').slice(0, 6);
        });

        passwordInput.focus();
    }

    // Public API
    return { init, isLoggedIn, clearSession };
})();

// Initialize auth when DOM is ready
document.addEventListener('DOMContentLoaded', YTAuth.init);
