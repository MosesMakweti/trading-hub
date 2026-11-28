//+------------------------------------------------------------------+
//| TraditoriumConnector.mq5                                         |
//| Traditorium MT5 Connector — Stage 1 (read-only account sync)     |
//|                                                                  |
//| STRICTLY READ-ONLY. This Expert Advisor never places, modifies   |
//| or closes orders or positions. It only READS account info,       |
//| history deals/orders and open positions, and sends them to       |
//| Traditorium over HTTPS (MQL5 WebRequest). It never asks for, and |
//| never sends, an MT5 master or investor password.                 |
//|                                                                  |
//| Setup (see docs/MT5_CONNECTOR.md):                               |
//|  1. Tools > Options > Expert Advisors > "Allow WebRequest for    |
//|     listed URL" — add your Traditorium address, e.g.             |
//|     https://app.example.com                                      |
//|  2. Generate a pairing code in Traditorium:                      |
//|     Settings > Integrations > MetaTrader 5 Connector.            |
//|  3. Attach this EA to any chart of the account to sync, set      |
//|     InpServerUrl and InpPairingCode.                             |
//+------------------------------------------------------------------+
#property copyright   "Traditorium"
#property version     "1.00"
#property description "Read-only MT5 account-history sync for Traditorium. Never trades."

#define EA_VERSION        "1.00"
#define STATE_FOLDER      "Traditorium"
#define MAX_QUEUE         5000
#define HTTP_TIMEOUT_MS   20000
#define MIN_BATCH         10

//--- inputs
input string InpServerUrl        = "https://";  // Traditorium address (must be whitelisted for WebRequest)
input string InpPairingCode      = "";          // Pairing code from Settings > Integrations
input int    InpHeartbeatSeconds = 60;          // Heartbeat interval (seconds)
input int    InpBatchSize        = 200;         // Deals/orders per request (10-450)
input int    InpReconcileMinutes = 15;          // Re-check recent history every N minutes

//--- persisted state (per MT5 login + server)
string g_token        = "";   // device token (td_mt5_...) — stored only in MQL5\Files\Traditorium
string g_gen          = "";   // pairing generation; salts idempotency keys
int    g_bfPhase      = 0;    // backfill: 0 = deals, 1 = orders, 2 = done
long   g_bfDealMsc    = -1;   // backfill cursor: last sent deal time (server ms)
long   g_bfOrderMsc   = -1;   // backfill cursor: last sent order time (server ms)
long   g_liveMsc      = 0;    // newest deal time acknowledged by the server
long   g_eventSeq     = 0;    // live-event batch counter
int    g_rcPhase      = 2;    // reconcile walker: 0 deals, 1 orders, 2 idle
long   g_rcDealMsc    = -1;
long   g_rcOrderMsc   = -1;

//--- runtime state
long     g_login        = 0;
string   g_server       = "";
bool     g_busy         = false;
bool     g_paused       = false;
bool     g_stopped      = false;    // fatal configuration problem; needs user action
string   g_status       = "Starting";
datetime g_nextAttempt  = 0;
int      g_failures     = 0;
datetime g_lastHeartbeat = 0;
datetime g_lastReconcile = 0;
bool     g_symbolsSent  = false;
int      g_batch        = 200;
int      g_keySalt      = 0;
long     g_lastObservedMsc = 0;

//--- live queues (filled by OnTradeTransaction, drained by OnTimer)
ulong  g_qDeals[];
ulong  g_qOrders[];
ulong  g_qPosTicket[];
double g_qPosSl[];
double g_qPosTp[];
long   g_qPosMsc[];
bool   g_needReconcile = false;

//--- an events payload that was sent but not yet acknowledged is re-sent
//--- verbatim (same Idempotency-Key, same body) until it is.
string g_pendingEventsBody = "";
string g_pendingEventsKey  = "";
long   g_pendingEventsMaxMsc = 0;

//+------------------------------------------------------------------+
//| JSON helpers                                                     |
//+------------------------------------------------------------------+
string JEsc(string s)
  {
   string out = "";
   int n = StringLen(s);
   for(int i = 0; i < n; i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c == '"')       out += "\\\"";
      else if(c == '\\') out += "\\\\";
      else if(c == '\n') out += "\\n";
      else if(c == '\r') out += "\\r";
      else if(c == '\t') out += "\\t";
      else if(c < 32)    out += StringFormat("\\u%04x", c);
      else               out += ShortToString(c);
     }
   return out;
  }

string JStr(string s)            { return "\"" + JEsc(s) + "\""; }
string JStrOrNull(string s)      { return s == "" ? "null" : JStr(s); }
string JTicket(ulong t)          { return "\"" + StringFormat("%I64u", t) + "\""; }
string JTicketOrNull(ulong t)    { return t == 0 ? "null" : JTicket(t); }
string JLong(long v)             { return StringFormat("%I64d", v); }
//--- decimals always travel as strings (never JSON numbers)
string JDec(double v, int digits) { return "\"" + DoubleToString(v, digits) + "\""; }

int MoneyDigits()
  {
   long d = AccountInfoInteger(ACCOUNT_CURRENCY_DIGITS);
   return (d <= 0 || d > 8) ? 2 : (int)d;
  }

//--- minimal response readers (the server's JSON is well-formed and flat enough)
string JsonGetString(string json, string key)
  {
   string pat = "\"" + key + "\":\"";
   int p = StringFind(json, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   string out = "";
   int n = StringLen(json);
   for(int i = p; i < n; i++)
     {
      ushort c = StringGetCharacter(json, i);
      if(c == '\\' && i + 1 < n) { out += ShortToString(StringGetCharacter(json, i + 1)); i++; continue; }
      if(c == '"') break;
      out += ShortToString(c);
     }
   return out;
  }

int JsonGetBool(string json, string key) // 1 true, 0 false, -1 absent
  {
   string pat = "\"" + key + "\":";
   int p = StringFind(json, pat);
   if(p < 0) return -1;
   string rest = StringSubstr(json, p + StringLen(pat), 5);
   if(StringFind(rest, "true") == 0) return 1;
   if(StringFind(rest, "false") == 0) return 0;
   return -1;
  }

//+------------------------------------------------------------------+
//| State persistence                                                |
//+------------------------------------------------------------------+
string StateFile()
  {
   string srv = g_server;
   string safe = "";
   for(int i = 0; i < StringLen(srv); i++)
     {
      ushort c = StringGetCharacter(srv, i);
      bool ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-' || c == '_';
      safe += ok ? ShortToString(c) : "_";
     }
   return STATE_FOLDER + "\\conn_" + JLong(g_login) + "_" + safe + ".txt";
  }

void ResetSyncState()
  {
   g_gen = ""; g_bfPhase = 0; g_bfDealMsc = -1; g_bfOrderMsc = -1;
   g_liveMsc = 0; g_eventSeq = 0; g_rcPhase = 2; g_rcDealMsc = -1; g_rcOrderMsc = -1;
   g_pendingEventsBody = ""; g_pendingEventsKey = ""; g_pendingEventsMaxMsc = 0;
  }

void SaveState()
  {
   if(g_login == 0) return;
   int h = FileOpen(StateFile(), FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) { Print("Traditorium: could not save state, error ", GetLastError()); return; }
   FileWriteString(h, "token=" + g_token + "\n");
   FileWriteString(h, "gen=" + g_gen + "\n");
   FileWriteString(h, "bfPhase=" + IntegerToString(g_bfPhase) + "\n");
   FileWriteString(h, "bfDealMsc=" + JLong(g_bfDealMsc) + "\n");
   FileWriteString(h, "bfOrderMsc=" + JLong(g_bfOrderMsc) + "\n");
   FileWriteString(h, "liveMsc=" + JLong(g_liveMsc) + "\n");
   FileWriteString(h, "eventSeq=" + JLong(g_eventSeq) + "\n");
   FileWriteString(h, "rcPhase=" + IntegerToString(g_rcPhase) + "\n");
   FileWriteString(h, "rcDealMsc=" + JLong(g_rcDealMsc) + "\n");
   FileWriteString(h, "rcOrderMsc=" + JLong(g_rcOrderMsc) + "\n");
   FileClose(h);
  }

void LoadState()
  {
   g_token = "";
   ResetSyncState();
   if(!FileIsExist(StateFile())) return;
   int h = FileOpen(StateFile(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      int eq = StringFind(line, "=");
      if(eq <= 0) continue;
      string k = StringSubstr(line, 0, eq);
      string v = StringSubstr(line, eq + 1);
      if(k == "token") g_token = v;
      else if(k == "gen") g_gen = v;
      else if(k == "bfPhase") g_bfPhase = (int)StringToInteger(v);
      else if(k == "bfDealMsc") g_bfDealMsc = StringToInteger(v);
      else if(k == "bfOrderMsc") g_bfOrderMsc = StringToInteger(v);
      else if(k == "liveMsc") g_liveMsc = StringToInteger(v);
      else if(k == "eventSeq") g_eventSeq = StringToInteger(v);
      else if(k == "rcPhase") g_rcPhase = (int)StringToInteger(v);
      else if(k == "rcDealMsc") g_rcDealMsc = StringToInteger(v);
      else if(k == "rcOrderMsc") g_rcOrderMsc = StringToInteger(v);
     }
   FileClose(h);
  }

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
string BaseUrl()
  {
   string u = InpServerUrl;
   StringTrimLeft(u);
   StringTrimRight(u);
   while(StringLen(u) > 0 && StringSubstr(u, StringLen(u) - 1) == "/") u = StringSubstr(u, 0, StringLen(u) - 1);
   return u;
  }

bool UrlAllowed(string u)
  {
   if(StringFind(u, "https://") == 0 && StringLen(u) > 8) return true;
   // Plain HTTP only for local development.
   if(StringFind(u, "http://localhost") == 0 || StringFind(u, "http://127.0.0.1") == 0) return true;
   return false;
  }

int Post(string path, string body, string idempotencyKey, string &response)
  {
   string headers = "Content-Type: application/json\r\n";
   if(g_token != "") headers += "Authorization: Bearer " + g_token + "\r\n";
   if(idempotencyKey != "") headers += "Idempotency-Key: " + idempotencyKey + "\r\n";
   char data[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1); // drop the terminating NUL
   char result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", BaseUrl() + path, headers, HTTP_TIMEOUT_MS, data, result, resultHeaders);
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status == -1)
     {
      int err = GetLastError();
      if(err == 4014)
        {
         g_status = "WebRequest is not allowed for " + BaseUrl() + ". Add it in Tools > Options > Expert Advisors.";
         g_stopped = true;
        }
      else g_status = "Network error " + IntegerToString(err) + " — will retry";
     }
   return status;
  }

void Backoff()
  {
   g_failures++;
   int secs = (int)MathMin(300, 5 * MathPow(2, MathMin(g_failures - 1, 6)));
   g_nextAttempt = TimeLocal() + secs;
  }

//--- common handling for non-2xx answers (sets status, backoff, or stops)
void HandleFailure(int status, string response)
  {
   string code = JsonGetString(response, "code");
   string msg  = JsonGetString(response, "error");
   if(status == 401)
     {
      Print("Traditorium: connector token rejected (disconnected in Traditorium?). Re-pair with a new code.");
      g_token = "";
      ResetSyncState();
      SaveState();
      g_status = "Disconnected — enter a new pairing code";
      return;
     }
   if(status == 403)
     {
      g_status = "Refused: " + msg;
      g_stopped = true;
      return;
     }
   if(status == 409 && code == "PAUSED") { g_paused = true; g_status = "Paused in Traditorium"; g_nextAttempt = TimeLocal() + 60; return; }
   if(status == 409 && code == "IDEMPOTENCY_CONFLICT") { g_keySalt++; return; }
   if(status == 413 || status == 422)
     {
      if(g_batch > MIN_BATCH) { g_batch = (int)MathMax(MIN_BATCH, g_batch / 2); g_status = "Reducing batch size to " + IntegerToString(g_batch); return; }
      g_status = "Server rejected a batch: " + msg;
      g_stopped = true;
      return;
     }
   if(status == 410) { g_status = "Pairing code invalid or expired — generate a new one"; g_stopped = true; return; }
   if(status > 0) g_status = "Server error " + IntegerToString(status) + (msg != "" ? (": " + msg) : "") + " — will retry";
   Backoff();
  }

//+------------------------------------------------------------------+
//| Serializers (read-only access to terminal data)                  |
//+------------------------------------------------------------------+
string AccountJson()
  {
   return "{\"login\":\"" + JLong(g_login) + "\",\"server\":" + JStr(g_server) + "}";
  }

string DealJson(ulong t)
  {
   int md = MoneyDigits();
   string s = "{";
   s += "\"ticket\":" + JTicket(t);
   s += ",\"order\":" + JTicketOrNull((ulong)HistoryDealGetInteger(t, DEAL_ORDER));
   s += ",\"positionId\":" + JTicketOrNull((ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID));
   s += ",\"timeMsc\":" + JLong(HistoryDealGetInteger(t, DEAL_TIME_MSC));
   s += ",\"type\":" + JStr(EnumToString((ENUM_DEAL_TYPE)HistoryDealGetInteger(t, DEAL_TYPE)));
   s += ",\"entry\":" + JStr(EnumToString((ENUM_DEAL_ENTRY)HistoryDealGetInteger(t, DEAL_ENTRY)));
   s += ",\"reason\":" + JStr(EnumToString((ENUM_DEAL_REASON)HistoryDealGetInteger(t, DEAL_REASON)));
   s += ",\"symbol\":" + JStrOrNull(HistoryDealGetString(t, DEAL_SYMBOL));
   s += ",\"volume\":" + JDec(HistoryDealGetDouble(t, DEAL_VOLUME), 8);
   s += ",\"price\":" + JDec(HistoryDealGetDouble(t, DEAL_PRICE), 10);
   s += ",\"profit\":" + JDec(HistoryDealGetDouble(t, DEAL_PROFIT), md);
   s += ",\"commission\":" + JDec(HistoryDealGetDouble(t, DEAL_COMMISSION), md);
   s += ",\"swap\":" + JDec(HistoryDealGetDouble(t, DEAL_SWAP), md);
   s += ",\"fee\":" + JDec(HistoryDealGetDouble(t, DEAL_FEE), md);
   s += ",\"sl\":" + JDec(HistoryDealGetDouble(t, DEAL_SL), 10);
   s += ",\"tp\":" + JDec(HistoryDealGetDouble(t, DEAL_TP), 10);
   s += ",\"magic\":\"" + JLong(HistoryDealGetInteger(t, DEAL_MAGIC)) + "\"";
   s += ",\"comment\":" + JStrOrNull(HistoryDealGetString(t, DEAL_COMMENT));
   s += ",\"externalId\":" + JStrOrNull(HistoryDealGetString(t, DEAL_EXTERNAL_ID));
   s += "}";
   return s;
  }

string OrderJson(ulong t)
  {
   string s = "{";
   s += "\"ticket\":" + JTicket(t);
   s += ",\"positionId\":" + JTicketOrNull((ulong)HistoryOrderGetInteger(t, ORDER_POSITION_ID));
   s += ",\"positionById\":" + JTicketOrNull((ulong)HistoryOrderGetInteger(t, ORDER_POSITION_BY_ID));
   s += ",\"type\":" + JStr(EnumToString((ENUM_ORDER_TYPE)HistoryOrderGetInteger(t, ORDER_TYPE)));
   s += ",\"state\":" + JStr(EnumToString((ENUM_ORDER_STATE)HistoryOrderGetInteger(t, ORDER_STATE)));
   s += ",\"reason\":" + JStr(EnumToString((ENUM_ORDER_REASON)HistoryOrderGetInteger(t, ORDER_REASON)));
   s += ",\"symbol\":" + JStrOrNull(HistoryOrderGetString(t, ORDER_SYMBOL));
   s += ",\"timeSetupMsc\":" + JLong(HistoryOrderGetInteger(t, ORDER_TIME_SETUP_MSC));
   s += ",\"timeDoneMsc\":" + JLong(HistoryOrderGetInteger(t, ORDER_TIME_DONE_MSC));
   s += ",\"volumeInitial\":" + JDec(HistoryOrderGetDouble(t, ORDER_VOLUME_INITIAL), 8);
   s += ",\"volumeCurrent\":" + JDec(HistoryOrderGetDouble(t, ORDER_VOLUME_CURRENT), 8);
   s += ",\"priceOpen\":" + JDec(HistoryOrderGetDouble(t, ORDER_PRICE_OPEN), 10);
   s += ",\"priceStopLimit\":" + JDec(HistoryOrderGetDouble(t, ORDER_PRICE_STOPLIMIT), 10);
   s += ",\"sl\":" + JDec(HistoryOrderGetDouble(t, ORDER_SL), 10);
   s += ",\"tp\":" + JDec(HistoryOrderGetDouble(t, ORDER_TP), 10);
   s += ",\"magic\":\"" + JLong(HistoryOrderGetInteger(t, ORDER_MAGIC)) + "\"";
   s += ",\"comment\":" + JStrOrNull(HistoryOrderGetString(t, ORDER_COMMENT));
   s += ",\"externalId\":" + JStrOrNull(HistoryOrderGetString(t, ORDER_EXTERNAL_ID));
   s += "}";
   return s;
  }

long OrderTimeMsc(ulong t)
  {
   long done = HistoryOrderGetInteger(t, ORDER_TIME_DONE_MSC);
   return done > 0 ? done : HistoryOrderGetInteger(t, ORDER_TIME_SETUP_MSC);
  }

//+------------------------------------------------------------------+
//| Pairing                                                          |
//+------------------------------------------------------------------+
void DoPair()
  {
   string code = InpPairingCode;
   StringTrimLeft(code);
   StringTrimRight(code);
   if(code == "") { g_status = "Enter the pairing code from Traditorium in the EA inputs"; return; }

   string marginMode = "HEDGING";
   long mm = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   if(mm == ACCOUNT_MARGIN_MODE_RETAIL_NETTING) marginMode = "NETTING";
   else if(mm == ACCOUNT_MARGIN_MODE_EXCHANGE) marginMode = "EXCHANGE";
   string tradeMode = "REAL";
   long tm = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(tm == ACCOUNT_TRADE_MODE_DEMO) tradeMode = "DEMO";
   else if(tm == ACCOUNT_TRADE_MODE_CONTEST) tradeMode = "CONTEST";

   string body = "{\"pairingCode\":" + JStr(code) + ",\"terminal\":{";
   body += "\"login\":\"" + JLong(g_login) + "\"";
   body += ",\"server\":" + JStr(g_server);
   body += ",\"company\":" + JStrOrNull(AccountInfoString(ACCOUNT_COMPANY));
   body += ",\"currency\":" + JStr(AccountInfoString(ACCOUNT_CURRENCY));
   body += ",\"currencyDigits\":" + IntegerToString(MoneyDigits());
   body += ",\"leverage\":" + JLong(AccountInfoInteger(ACCOUNT_LEVERAGE));
   body += ",\"marginMode\":" + JStr(marginMode);
   body += ",\"tradeMode\":" + JStr(tradeMode);
   body += ",\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
   body += ",\"eaVersion\":" + JStr(EA_VERSION);
   body += ",\"gmtOffsetSeconds\":" + JLong((long)(TimeTradeServer() - TimeGMT()));
   body += "}}";

   string saved = g_token;
   g_token = ""; // the pair endpoint is unauthenticated
   string response;
   int status = Post("/api/v1/mt5/pair", body, "", response);
   if(status == 201)
     {
      ResetSyncState();
      g_token = JsonGetString(response, "deviceToken");
      g_gen = IntegerToString((long)TimeLocal());
      g_failures = 0;
      g_symbolsSent = false;
      SaveState();
      g_status = "Paired — importing history";
      Print("Traditorium: paired MT5 account ", g_login, " @ ", g_server, ".");
      return;
     }
   g_token = saved;
   if(status == 409 || status == 429)
     {
      // e.g. statement-import conflict or identity mismatch: retry slowly so a
      // fix made in Traditorium is picked up without restarting the EA.
      g_status = "Pairing refused: " + JsonGetString(response, "error");
      g_nextAttempt = TimeLocal() + 60;
      return;
     }
   HandleFailure(status, response);
  }

//+------------------------------------------------------------------+
//| Heartbeat (account snapshot + open positions)                    |
//+------------------------------------------------------------------+
void DoHeartbeat()
  {
   int md = MoneyDigits();
   string body = "{\"account\":" + AccountJson();
   body += ",\"eaVersion\":" + JStr(EA_VERSION);
   body += ",\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
   body += ",\"gmtOffsetSeconds\":" + JLong((long)(TimeTradeServer() - TimeGMT()));
   body += ",\"serverTimeMsc\":" + JLong((long)TimeTradeServer() * 1000);
   body += ",\"snapshot\":{";
   body += "\"balance\":" + JDec(AccountInfoDouble(ACCOUNT_BALANCE), md);
   body += ",\"equity\":" + JDec(AccountInfoDouble(ACCOUNT_EQUITY), md);
   body += ",\"margin\":" + JDec(AccountInfoDouble(ACCOUNT_MARGIN), md);
   body += ",\"freeMargin\":" + JDec(AccountInfoDouble(ACCOUNT_MARGIN_FREE), md);
   body += ",\"credit\":" + JDec(AccountInfoDouble(ACCOUNT_CREDIT), md);
   body += ",\"profit\":" + JDec(AccountInfoDouble(ACCOUNT_PROFIT), md);
   body += "},\"openPositions\":[";
   int total = PositionsTotal();
   int written = 0;
   for(int i = 0; i < total && written < 1000; i++)
     {
      ulong ticket = PositionGetTicket(i); // selects the position (read-only)
      if(ticket == 0) continue;
      if(written > 0) body += ",";
      long type = PositionGetInteger(POSITION_TYPE);
      body += "{\"positionId\":" + JTicket((ulong)PositionGetInteger(POSITION_IDENTIFIER));
      body += ",\"symbol\":" + JStr(PositionGetString(POSITION_SYMBOL));
      body += ",\"type\":" + JStr(type == POSITION_TYPE_BUY ? "POSITION_TYPE_BUY" : "POSITION_TYPE_SELL");
      body += ",\"volume\":" + JDec(PositionGetDouble(POSITION_VOLUME), 8);
      body += ",\"priceOpen\":" + JDec(PositionGetDouble(POSITION_PRICE_OPEN), 10);
      body += ",\"priceCurrent\":" + JDec(PositionGetDouble(POSITION_PRICE_CURRENT), 10);
      body += ",\"sl\":" + JDec(PositionGetDouble(POSITION_SL), 10);
      body += ",\"tp\":" + JDec(PositionGetDouble(POSITION_TP), 10);
      body += ",\"swap\":" + JDec(PositionGetDouble(POSITION_SWAP), md);
      body += ",\"profit\":" + JDec(PositionGetDouble(POSITION_PROFIT), md);
      body += ",\"timeMsc\":" + JLong(PositionGetInteger(POSITION_TIME_MSC));
      body += ",\"magic\":\"" + JLong(PositionGetInteger(POSITION_MAGIC)) + "\"";
      body += ",\"comment\":" + JStrOrNull(PositionGetString(POSITION_COMMENT));
      body += "}";
      written++;
     }
   body += "]}";

   string response;
   int status = Post("/api/v1/mt5/heartbeat", body, "", response);
   if(status != 200) { HandleFailure(status, response); return; }
   g_failures = 0;
   g_lastHeartbeat = TimeLocal();
   g_paused = (JsonGetString(response, "status") == "PAUSED");
   // The server is the source of truth for whether history still has to be
   // (re)sent — e.g. after the account was re-paired.
   if(JsonGetBool(response, "required") == 1 && g_bfPhase == 2)
     {
      g_bfPhase = 0; g_bfDealMsc = -1; g_bfOrderMsc = -1;
      SaveState();
     }
  }

//+------------------------------------------------------------------+
//| History walker (backfill and reconcile)                          |
//| Sends deals then orders in time order, in batches. A batch       |
//| never splits a millisecond, so the time-only cursor is exact.    |
//+------------------------------------------------------------------+
bool SelectAllHistory(long fromMsc)
  {
   datetime from = fromMsc <= 0 ? 0 : (datetime)(fromMsc / 1000 - 1);
   return HistorySelect(from, TimeCurrent() + 86400);
  }

// Fills `tickets` with the next batch after `cursorMsc`; returns the last time included, or -1 when nothing is left.
long NextDealBatch(long cursorMsc, ulong &tickets[], bool &more)
  {
   int n = HistoryDealsTotal();
   long keys[][2];
   ArrayResize(keys, n);
   int k = 0;
   for(int i = 0; i < n; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long ms = HistoryDealGetInteger(t, DEAL_TIME_MSC);
      if(ms <= cursorMsc) continue;
      keys[k][0] = ms;
      keys[k][1] = (long)t;
      k++;
     }
   ArrayResize(keys, k);
   if(k > 1) ArraySort(keys);
   ArrayResize(tickets, 0);
   more = false;
   if(k == 0) return -1;
   long last = -1;
   for(int i = 0; i < k; i++)
     {
      if(ArraySize(tickets) >= g_batch && keys[i][0] != last) { more = true; break; }
      int sz = ArraySize(tickets);
      ArrayResize(tickets, sz + 1);
      tickets[sz] = (ulong)keys[i][1];
      last = keys[i][0];
     }
   return last;
  }

long NextOrderBatch(long cursorMsc, ulong &tickets[], bool &more)
  {
   int n = HistoryOrdersTotal();
   long keys[][2];
   ArrayResize(keys, n);
   int k = 0;
   for(int i = 0; i < n; i++)
     {
      ulong t = HistoryOrderGetTicket(i);
      if(t == 0) continue;
      long ms = OrderTimeMsc(t);
      if(ms <= cursorMsc) continue;
      keys[k][0] = ms;
      keys[k][1] = (long)t;
      k++;
     }
   ArrayResize(keys, k);
   if(k > 1) ArraySort(keys);
   ArrayResize(tickets, 0);
   more = false;
   if(k == 0) return -1;
   long last = -1;
   for(int i = 0; i < k; i++)
     {
      if(ArraySize(tickets) >= g_batch && keys[i][0] != last) { more = true; break; }
      int sz = ArraySize(tickets);
      ArrayResize(tickets, sz + 1);
      tickets[sz] = (ulong)keys[i][1];
      last = keys[i][0];
     }
   return last;
  }

// One request of the walker. Returns true when the walker has finished.
bool WalkStep(string kind, int &phase, long &dealMsc, long &orderMsc)
  {
   ulong tickets[];
   bool more = false;
   string deals = "", orders = "";
   long last = -1;
   bool isFinal = false;
   string tag;

   if(phase == 0)
     {
      if(!SelectAllHistory(dealMsc)) { g_status = "HistorySelect failed — will retry"; Backoff(); return false; }
      last = NextDealBatch(dealMsc, tickets, more);
      if(last < 0) { phase = 1; SaveState(); return false; }
      for(int i = 0; i < ArraySize(tickets); i++) deals += (i > 0 ? "," : "") + DealJson(tickets[i]);
      tag = "d";
     }
   else
     {
      if(!SelectAllHistory(orderMsc)) { g_status = "HistorySelect failed — will retry"; Backoff(); return false; }
      last = NextOrderBatch(orderMsc, tickets, more);
      for(int i = 0; i < ArraySize(tickets); i++) orders += (i > 0 ? "," : "") + OrderJson(tickets[i]);
      isFinal = (kind == "BACKFILL") && !more;
      tag = "o";
      if(last < 0 && kind != "BACKFILL") { phase = 2; SaveState(); return true; }
     }

   int count = ArraySize(tickets);
   string key = StringFormat("%s-%s-%s-%s-%I64u-%I64u-%d-%d",
                             kind == "BACKFILL" ? "bf" : "rc", g_gen, tag,
                             JLong(phase == 0 ? dealMsc : orderMsc),
                             count > 0 ? tickets[0] : 0, count > 0 ? tickets[count - 1] : 0, count, g_keySalt);
   string body = "{\"account\":" + AccountJson() + ",\"kind\":" + JStr(kind);
   body += ",\"isFinal\":" + (isFinal ? "true" : "false");
   body += ",\"deals\":[" + deals + "],\"orders\":[" + orders + "]}";

   string response;
   int status = Post("/api/v1/mt5/history", body, key, response);
   if(status != 200) { HandleFailure(status, response); return false; }
   g_failures = 0;

   if(phase == 0)
     {
      dealMsc = last;
      if(last > g_liveMsc) g_liveMsc = last;
      if(!more) phase = 1;
     }
   else
     {
      if(last >= 0) orderMsc = last;
      if(!more) phase = 2;
     }
   SaveState();
   return phase == 2;
  }

//+------------------------------------------------------------------+
//| Live events (queued by OnTradeTransaction)                       |
//+------------------------------------------------------------------+
void DoEvents()
  {
   if(g_pendingEventsBody == "")
     {
      int nd = (int)MathMin(ArraySize(g_qDeals), g_batch);
      int no = (int)MathMin(ArraySize(g_qOrders), g_batch);
      int np = (int)MathMin(ArraySize(g_qPosTicket), 450);
      string deals = "", orders = "", changes = "";
      long maxMsc = 0;
      int written = 0;
      for(int i = 0; i < nd; i++)
        {
         if(!HistoryDealSelect(g_qDeals[i])) continue; // not in history yet; reconcile will catch it
         deals += (written > 0 ? "," : "") + DealJson(g_qDeals[i]);
         long ms = HistoryDealGetInteger(g_qDeals[i], DEAL_TIME_MSC);
         if(ms > maxMsc) maxMsc = ms;
         written++;
        }
      written = 0;
      for(int i = 0; i < no; i++)
        {
         if(!HistoryOrderSelect(g_qOrders[i])) continue;
         orders += (written > 0 ? "," : "") + OrderJson(g_qOrders[i]);
         written++;
        }
      for(int i = 0; i < np; i++)
        {
         ulong id = g_qPosTicket[i];
         if(PositionSelectByTicket(g_qPosTicket[i])) id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
         changes += (i > 0 ? "," : "") + "{\"positionId\":" + JTicket(id) + ",\"sl\":" + JDec(g_qPosSl[i], 10) +
                    ",\"tp\":" + JDec(g_qPosTp[i], 10) + ",\"observedAtMsc\":" + JLong(g_qPosMsc[i]) + "}";
        }
      ArrayRemove(g_qDeals, 0, nd);
      ArrayRemove(g_qOrders, 0, no);
      ArrayRemove(g_qPosTicket, 0, np);
      ArrayRemove(g_qPosSl, 0, np);
      ArrayRemove(g_qPosTp, 0, np);
      ArrayRemove(g_qPosMsc, 0, np);
      if(deals == "" && orders == "" && changes == "") return;
      g_eventSeq++;
      SaveState();
      g_pendingEventsKey = "ev-" + g_gen + "-" + JLong(g_eventSeq);
      g_pendingEventsBody = "{\"account\":" + AccountJson() + ",\"deals\":[" + deals + "],\"orders\":[" + orders + "],\"positionChanges\":[" + changes + "]}";
      g_pendingEventsMaxMsc = maxMsc;
     }
   string response;
   int status = Post("/api/v1/mt5/events", g_pendingEventsBody, g_pendingEventsKey + (g_keySalt > 0 ? "-" + IntegerToString(g_keySalt) : ""), response);
   if(status != 200)
     {
      HandleFailure(status, response);
      if(status == 413 || status == 422) { g_pendingEventsBody = ""; g_needReconcile = true; } // re-collected by reconcile
      return;
     }
   g_failures = 0;
   if(g_pendingEventsMaxMsc > g_liveMsc) g_liveMsc = g_pendingEventsMaxMsc;
   g_pendingEventsBody = "";
   g_pendingEventsKey = "";
   SaveState();
  }

//+------------------------------------------------------------------+
//| Symbol specifications (informational)                            |
//+------------------------------------------------------------------+
void DoSymbols()
  {
   int total = (int)MathMin(SymbolsTotal(true), 450);
   string specs = "";
   for(int i = 0; i < total; i++)
     {
      string sym = SymbolName(i, true);
      if(sym == "") continue;
      specs += (specs == "" ? "" : ",") + "{\"symbol\":" + JStr(sym) +
               ",\"description\":" + JStrOrNull(SymbolInfoString(sym, SYMBOL_DESCRIPTION)) +
               ",\"digits\":" + IntegerToString((int)SymbolInfoInteger(sym, SYMBOL_DIGITS)) +
               ",\"contractSize\":" + JDec(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 8) +
               ",\"tickSize\":" + JDec(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), 10) +
               ",\"tickValue\":" + JDec(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), 10) +
               ",\"volumeMin\":" + JDec(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), 8) +
               ",\"volumeMax\":" + JDec(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), 8) +
               ",\"volumeStep\":" + JDec(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), 8) +
               ",\"currencyBase\":" + JStrOrNull(SymbolInfoString(sym, SYMBOL_CURRENCY_BASE)) +
               ",\"currencyProfit\":" + JStrOrNull(SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT)) +
               ",\"currencyMargin\":" + JStrOrNull(SymbolInfoString(sym, SYMBOL_CURRENCY_MARGIN)) + "}";
     }
   string response;
   int status = Post("/api/v1/mt5/symbols", "{\"account\":" + AccountJson() + ",\"specs\":[" + specs + "]}", "", response);
   if(status == 200) g_symbolsSent = true;
   else HandleFailure(status, response);
  }

//+------------------------------------------------------------------+
//| Account identity                                                 |
//+------------------------------------------------------------------+
bool RefreshIdentity()
  {
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string server = AccountInfoString(ACCOUNT_SERVER);
   if(login == 0 || server == "") return false;
   if(login != g_login || server != g_server)
     {
      // Account switched in this terminal: use that account's own state/token.
      SaveState();
      g_login = login;
      g_server = server;
      LoadState();
      g_paused = false;
      g_stopped = false;
      g_symbolsSent = false;
      g_lastHeartbeat = 0;
      ArrayResize(g_qDeals, 0); ArrayResize(g_qOrders, 0);
      ArrayResize(g_qPosTicket, 0); ArrayResize(g_qPosSl, 0); ArrayResize(g_qPosTp, 0); ArrayResize(g_qPosMsc, 0);
     }
   return true;
  }

void ShowStatus()
  {
   string phase = g_bfPhase < 2 ? (g_bfPhase == 0 ? "importing deals" : "importing orders") : "history imported";
   Comment("Traditorium Connector " + EA_VERSION + " (read-only)\n" +
           "Account: " + JLong(g_login) + " @ " + g_server + "\n" +
           "Status: " + g_status + "\n" +
           (g_token != "" ? ("Sync: " + phase + (g_paused ? " · PAUSED" : "") + "\n") : "") +
           "Queued live events: " + IntegerToString(ArraySize(g_qDeals) + ArraySize(g_qOrders) + ArraySize(g_qPosTicket)));
  }

//+------------------------------------------------------------------+
//| Event handlers                                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(MQLInfoInteger(MQL_TESTER))
     {
      Print("Traditorium: the connector does not run in the Strategy Tester (WebRequest is unavailable there).");
      return INIT_FAILED;
     }
   if(!UrlAllowed(BaseUrl()))
     {
      Alert("Traditorium: InpServerUrl must be an https:// address (http:// only for localhost).");
      return INIT_PARAMETERS_INCORRECT;
     }
   g_batch = (int)MathMax(MIN_BATCH, MathMin(450, InpBatchSize));
   if(!FolderCreate(STATE_FOLDER)) { /* already exists */ }
   RefreshIdentity();
   EventSetTimer(2);
   g_status = "Starting";
   ShowStatus();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   SaveState();
   Comment("");
  }

// Must stay fast: only queues; all network I/O happens in OnTimer.
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD && trans.deal > 0)
     {
      int n = ArraySize(g_qDeals);
      if(n >= MAX_QUEUE) { g_needReconcile = true; return; }
      ArrayResize(g_qDeals, n + 1, 256);
      g_qDeals[n] = trans.deal;
     }
   else if(trans.type == TRADE_TRANSACTION_HISTORY_ADD && trans.order > 0)
     {
      int n = ArraySize(g_qOrders);
      if(n >= MAX_QUEUE) { g_needReconcile = true; return; }
      ArrayResize(g_qOrders, n + 1, 256);
      g_qOrders[n] = trans.order;
     }
   else if(trans.type == TRADE_TRANSACTION_POSITION && trans.position > 0)
     {
      int n = ArraySize(g_qPosTicket);
      if(n >= MAX_QUEUE) return; // observations only; the next change will be recorded
      long ms = (long)TimeTradeServer() * 1000;
      if(ms <= g_lastObservedMsc) ms = g_lastObservedMsc + 1;
      g_lastObservedMsc = ms;
      ArrayResize(g_qPosTicket, n + 1, 64);
      ArrayResize(g_qPosSl, n + 1, 64);
      ArrayResize(g_qPosTp, n + 1, 64);
      ArrayResize(g_qPosMsc, n + 1, 64);
      g_qPosTicket[n] = trans.position;
      g_qPosSl[n] = trans.price_sl;
      g_qPosTp[n] = trans.price_tp;
      g_qPosMsc[n] = ms;
     }
  }

void OnTimer()
  {
   if(g_busy) return;
   g_busy = true;
   Work();
   ShowStatus();
   g_busy = false;
  }

void Work()
  {
   if(!RefreshIdentity()) { g_status = "Waiting for the terminal to log in"; return; }
   if(g_stopped) return;
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) { g_status = "Terminal not connected to the trade server"; return; }
   if(TimeLocal() < g_nextAttempt) return;

   if(g_token == "") { DoPair(); return; }

   if(g_lastHeartbeat == 0 || TimeLocal() - g_lastHeartbeat >= MathMax(15, InpHeartbeatSeconds))
     {
      DoHeartbeat();
      return;
     }
   if(g_paused) { g_status = "Paused in Traditorium"; return; }

   if(g_pendingEventsBody != "" || ArraySize(g_qDeals) > 0 || ArraySize(g_qOrders) > 0 || ArraySize(g_qPosTicket) > 0)
     {
      DoEvents();
      g_status = "Live";
      return;
     }
   if(g_bfPhase < 2)
     {
      if(WalkStep("BACKFILL", g_bfPhase, g_bfDealMsc, g_bfOrderMsc)) g_status = "History imported";
      else if(!g_stopped && g_failures == 0) g_status = "Importing history";
      return;
     }
   if(!g_symbolsSent) { DoSymbols(); return; }

   // Periodic (and post-restart) reconciliation of recent history: anything
   // missed while the terminal or network was down is re-sent; the server
   // skips duplicates.
   if(g_rcPhase == 2 && (g_needReconcile || g_lastReconcile == 0 || TimeLocal() - g_lastReconcile >= InpReconcileMinutes * 60))
     {
      g_rcPhase = 0;
      long from = g_liveMsc - 3600 * 1000;
      g_rcDealMsc = from < 0 ? -1 : from;
      g_rcOrderMsc = g_rcDealMsc;
      g_needReconcile = false;
     }
   if(g_rcPhase < 2)
     {
      if(WalkStep("RECONCILE", g_rcPhase, g_rcDealMsc, g_rcOrderMsc)) g_lastReconcile = TimeLocal();
      return;
     }
   g_status = "Live";
  }
//+------------------------------------------------------------------+
