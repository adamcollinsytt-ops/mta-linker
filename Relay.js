const WebSocket = require("ws");

const PORT = process.env.PORT || 9373;
const wss  = new WebSocket.Server({ port: PORT });

// players: username -> ws
const players = new Map();

// friends:  username -> Set<username>
const friends = new Map();

// pendingRequests: username -> Set<username>  (من أرسل لهم طلب)
const pendingRequests = new Map();

console.log(`[SERVER] Running on ${PORT}`);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function send(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(obj));
}

function sendTo(username, obj) {
    const ws = players.get(username);
    if (ws) send(ws, obj);
}

function getFriends(username) {
    if (!friends.has(username)) friends.set(username, new Set());
    return friends.get(username);
}

function getPending(username) {
    if (!pendingRequests.has(username)) pendingRequests.set(username, new Set());
    return pendingRequests.get(username);
}

function broadcastOnlineList() {
    const online = Array.from(players.keys());
    const msg = JSON.stringify({ type: "ONLINE_LIST", players: online });
    for (const ws of players.values()) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(msg);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────────

wss.on("connection", (ws) => {
    ws.username = null;

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); }
        catch { return; }

        if (!msg.type) return;

        switch (msg.type) {

            // ── LOGIN ────────────────────────────────────────────────────────
            case "LOGIN": {
                const username = (msg.username || "").trim();
                if (!username) return;

                // لو نفس اليوزر متصل من قبل، قطعه
                if (players.has(username)) {
                    const old = players.get(username);
                    old._replaced = true;
                    old.close();
                }

                ws.username = username;
                players.set(username, ws);
                console.log(`[+] ${username}`);

                // رد LOGIN_OK مع قائمة الأصدقاء
                const myFriends = Array.from(getFriends(username));
                send(ws, {
                    type:    "LOGIN_OK",
                    friends: myFriends
                });

                broadcastOnlineList();
                break;
            }

            // ── FRIEND_REQUEST ───────────────────────────────────────────────
            case "FRIEND_REQUEST": {
                const { to } = msg;
                if (!ws.username || !to || to === ws.username) return;

                const from = ws.username;

                // لو أصدقاء أصلاً، تجاهل
                if (getFriends(from).has(to)) return;

                // لو الطرف الثاني أرسل طلب من قبل → قبول تلقائي
                if (getPending(to).has(from)) {
                    addFriendBoth(from, to);
                    getPending(to).delete(from);

                    sendTo(from, { type: "FRIEND_ADDED", username: to });
                    sendTo(to,   { type: "FRIEND_ADDED", username: from });
                    console.log(`[ACC] ${from} <-> ${to}`);
                    return;
                }

                getPending(from).add(to);
                console.log(`[REQ] ${from} -> ${to}`);

                sendTo(to, { type: "FRIEND_REQUEST", from });
                break;
            }

            // ── ACCEPT_FRIEND ────────────────────────────────────────────────
            case "ACCEPT_FRIEND": {
                const { from: requester } = msg;
                if (!ws.username || !requester) return;

                const accepter = ws.username;

                // تحقق إن الطلب موجود
                if (!getPending(requester).has(accepter)) return;

                getPending(requester).delete(accepter);
                addFriendBoth(requester, accepter);

                sendTo(requester, { type: "FRIEND_ADDED", username: accepter });
                sendTo(accepter,  { type: "FRIEND_ADDED", username: requester });
                console.log(`[ACC] ${requester} <-> ${accepter}`);
                break;
            }

            // ── REMOVE_FRIEND ────────────────────────────────────────────────
            case "REMOVE_FRIEND": {
                const { username: target } = msg;
                if (!ws.username || !target) return;

                const me = ws.username;
                getFriends(me).delete(target);
                getFriends(target).delete(me);

                sendTo(target, { type: "FRIEND_REMOVED", username: me });
                send(ws,       { type: "FRIEND_REMOVED", username: target });
                break;
            }

            // ── INVITE ───────────────────────────────────────────────────────
            case "INVITE": {
                const { to } = msg;
                if (!ws.username || !to || to === ws.username) return;

                const from = ws.username;
                console.log(`[INV] ${from} -> ${to}`);

                sendTo(to, { type: "INVITE", from });
                break;
            }

            // ── ACCEPT_INVITE ────────────────────────────────────────────────
            case "ACCEPT_INVITE": {
                const { from: host } = msg;
                if (!ws.username || !host) return;

                const guest = ws.username;
                console.log(`[SES] ${host} <-> ${guest}`);

                // أبلغ الـ HOST
                sendTo(host,  { type: "SESSION_START", role: "HOST",  guest });
                // أبلغ الـ GUEST
                sendTo(guest, { type: "SESSION_START", role: "GUEST", host });
                break;
            }

            // ── TUNNEL ───────────────────────────────────────────────────────
            case "TUNNEL": {
                if (!ws.username || !msg.to || !msg.data) return;

                sendTo(msg.to, {
                    type: "TUNNEL",
                    from: ws.username,
                    data: msg.data
                });
                break;
            }

            // ── SESSION_END ──────────────────────────────────────────────────
            case "SESSION_END": {
                if (!ws.username || !msg.to) return;

                sendTo(msg.to, { type: "SESSION_END" });
                break;
            }
        }
    });

    ws.on("close", () => {
        if (!ws.username) return;
        if (ws._replaced) return; // تم استبداله بـ login جديد

        console.log(`[-] ${ws.username}`);
        players.delete(ws.username);
        broadcastOnlineList();
    });

    ws.on("error", (err) => {
        if (ws.username)
            console.error(`[ERR] ${ws.username}: ${err.message}`);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function addFriendBoth(a, b) {
    getFriends(a).add(b);
    getFriends(b).add(a);
}
