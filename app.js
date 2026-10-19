(() => {
  const cfg = window.SUPABASE_CONFIG || {};
  const configured = cfg.url && cfg.anonKey &&
    !cfg.url.includes("YOUR-PROJECT") &&
    !cfg.anonKey.includes("YOUR_SUPABASE");
  const supabaseLib = window.supabase;
  const client = configured && supabaseLib
    ? supabaseLib.createClient(cfg.url, cfg.anonKey)
    : null;

  const $ = (id) => document.getElementById(id);
  const state = { session: null, admin: false, resources: [] };
  const overlay = $("adminOverlay");
  const status = (id, msg, type = "") => {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = "status" + (type ? " " + type : "");
  };
  const safeUrl = (url) => {
    try {
      const parsed = new URL(url);
      return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
    } catch { return null; }
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const openAdmin = () => {
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    renderAdminState();
  };
  const closeAdmin = () => {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  };

  // The admin route is intentionally unobtrusive, but security is enforced by Supabase Auth + RLS.
  function handleHash() {
    if (location.hash === "#admin") openAdmin();
    else closeAdmin();
  }
  window.addEventListener("hashchange", handleHash);
  $("closeAdmin").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);
    closeAdmin();
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) closeAdmin(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAdmin(); });

  function renderAdminState() {
    $("loginPanel").classList.toggle("hidden", !!state.admin);
    $("dashboard").classList.toggle("hidden", !state.admin);
    if (state.session?.user?.email) $("signedInAs").textContent = state.session.user.email;
  }

  function setWhatsApp(number) {
    const clean = String(number || "").replace(/\D/g, "");
    const url = clean ? `https://wa.me/${clean}` : "https://wa.me/";
    ["topWhatsApp", "socialWhatsApp", "contactWhatsApp"].forEach(id => {
      const el = $(id);
      if (el) el.href = url;
    });
  }

  function renderPublic() {
    const categories = [
      ["file", "filesList", "ملف"],
      ["note", "notesList", "مذكرة"],
      ["link", "linksList", "رابط"]
    ];
    categories.forEach(([kind, containerId, label]) => {
      const container = $(containerId);
      const items = state.resources.filter(item => item.kind === kind);
      if (!items.length) {
        container.innerHTML = `<div class="empty">لا توجد ${label === "رابط" ? "روابط" : label === "مذكرة" ? "مذكرات" : "ملفات"} مضافة حاليًا.</div>`;
        return;
      }
      container.innerHTML = items.map(item => {
        const url = safeUrl(item.url);
        if (!url) return "";
        const buttonText = kind === "link" ? "فتح الرابط ↗" : "تحميل ↗";
        return `<div class="resource-item">
          <div><strong>${esc(item.title)}</strong><small>${esc(item.description || (kind === "link" ? "رابط خارجي" : "ملف تعليمي"))}</small></div>
          <a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${buttonText}</a>
        </div>`;
      }).join("");
    });
  }

  async function loadPublic() {
    if (!client) {
      ["filesList", "notesList", "linksList"].forEach(id => {
        $(id).innerHTML = '<div class="empty">اربط الموقع بمشروع Supabase لإظهار الملفات المنشورة.</div>';
      });
      $("publicStatus").textContent = "إعداد مطلوب: أضف بيانات Supabase داخل config.js ثم ارفع ملفات المشروع للاستضافة.";
      return;
    }
    const { data, error } = await client.from("site_resources")
      .select("id,title,description,kind,url,storage_path,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      $("publicStatus").textContent = "تعذر تحميل المحتوى. راجع إعداد قاعدة البيانات.";
      console.error(error);
      return;
    }
    state.resources = data || [];
    renderPublic();
    const { data: setting } = await client.from("site_settings").select("value").eq("key", "whatsapp").maybeSingle();
    if (setting?.value) setWhatsApp(setting.value);
    $("publicStatus").textContent = "";
  }

  async function refreshAdminList() {
    const box = $("manageList");
    box.innerHTML = '<div class="empty">جاري تحميل المحتوى...</div>';
    const { data, error } = await client.from("site_resources")
      .select("id,title,description,kind,url,storage_path,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      box.innerHTML = '<div class="empty">تعذر تحميل المحتوى.</div>';
      status("manageStatus", error.message, "error");
      return;
    }
    state.resources = data || [];
    renderPublic();
    if (!data?.length) {
      box.innerHTML = '<div class="empty">لسه مفيش محتوى. أضف ملفًا أو رابطًا من التبويبات بالأعلى.</div>';
      return;
    }
    box.innerHTML = data.map(item => `
      <div class="admin-row">
        <div><strong>${esc(item.title)}</strong><small>${esc(({file:"ملف",note:"مذكرة",link:"رابط"})[item.kind] || item.kind)} · ${esc(item.created_at ? new Date(item.created_at).toLocaleDateString("ar-EG") : "")}</small></div>
        <button class="btn danger" data-delete="${esc(item.id)}" type="button">حذف</button>
      </div>`).join("");
    box.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteResource(btn.dataset.delete)));
  }

  async function verifyAdmin(session) {
    if (!client || !session?.user) {
      state.session = null; state.admin = false; renderAdminState(); return;
    }
    state.session = session;
    const { data, error } = await client.from("site_admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
    state.admin = !!data && !error;
    renderAdminState();
    if (state.admin) {
      await refreshAdminList();
      const { data: setting } = await client.from("site_settings").select("value").eq("key", "whatsapp").maybeSingle();
      $("whatsappNumber").value = setting?.value || "";
    } else if (location.hash === "#admin") {
      status("loginStatus", "الحساب مسجل، لكنه غير مضاف كمدير للموقع. أضف UUID إلى جدول site_admins.", "error");
      await client.auth.signOut();
      state.session = null;
      renderAdminState();
    }
  }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!client) return status("loginStatus", "أكمل إعداد config.js أولًا.", "error");
    status("loginStatus", "جاري تسجيل الدخول...");
    const { data, error } = await client.auth.signInWithPassword({
      email: $("email").value.trim(), password: $("password").value
    });
    if (error) return status("loginStatus", error.message, "error");
    await verifyAdmin(data.session);
    if (state.admin) status("loginStatus", "تم تسجيل الدخول.", "ok");
  });

  $("logoutBtn").addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    state.session = null; state.admin = false; renderAdminState();
    status("loginStatus", "تم تسجيل الخروج.", "ok");
  });

  document.querySelectorAll(".admin-tabs button").forEach(btn => btn.addEventListener("click", async () => {
    document.querySelectorAll(".admin-tabs button").forEach(b => b.classList.toggle("active", b === btn));
    ["file", "link", "manage", "settings"].forEach(tab => $("tab-" + tab).classList.toggle("hidden", tab !== btn.dataset.tab));
    if (btn.dataset.tab === "manage") await refreshAdminList();
  }));

  $("fileForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!state.admin) return status("fileStatus", "سجّل الدخول بحساب مدير.", "error");
    const file = $("fileUpload").files[0];
    if (!file) return status("fileStatus", "اختار ملفًا أولًا.", "error");
    if (file.size > 20 * 1024 * 1024) return status("fileStatus", "حجم الملف أكبر من 20MB.", "error");
    status("fileStatus", "جاري رفع الملف...");
    const cleanName = file.name.normalize("NFKD").replace(/[^\w.\-\u0600-\u06FF]+/g, "_").slice(-120);
    const path = `${state.session.user.id}/${crypto.randomUUID()}-${cleanName}`;
    const { error: uploadError } = await client.storage.from("teaching-files").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream"
    });
    if (uploadError) return status("fileStatus", uploadError.message, "error");
    const { data: publicUrlData } = client.storage.from("teaching-files").getPublicUrl(path);
    const { error: insertError } = await client.from("site_resources").insert({
      title: $("fileTitle").value.trim(),
      description: $("fileDescription").value.trim(),
      kind: $("fileCategory").value,
      url: publicUrlData.publicUrl,
      storage_path: path
    });
    if (insertError) {
      await client.storage.from("teaching-files").remove([path]);
      return status("fileStatus", insertError.message, "error");
    }
    $("fileForm").reset();
    status("fileStatus", "تم رفع الملف ونشره بنجاح.", "ok");
    await refreshAdminList();
  });

  $("linkForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!state.admin) return status("linkStatus", "سجّل الدخول بحساب مدير.", "error");
    const url = safeUrl($("linkUrl").value.trim());
    if (!url) return status("linkStatus", "أدخل رابطًا صحيحًا يبدأ بـ http:// أو https://.", "error");
    const { error } = await client.from("site_resources").insert({
      title: $("linkTitle").value.trim(),
      description: $("linkDescription").value.trim(),
      kind: "link", url, storage_path: null
    });
    if (error) return status("linkStatus", error.message, "error");
    $("linkForm").reset();
    status("linkStatus", "تم حفظ الرابط ونشره.", "ok");
    await refreshAdminList();
  });

  async function deleteResource(id) {
    if (!state.admin) return;
    const item = state.resources.find(r => r.id === id);
    if (!item || !confirm(`متأكد إنك عايز تحذف "${item.title}"؟`)) return;
    status("manageStatus", "جاري الحذف...");
    const { error } = await client.from("site_resources").delete().eq("id", id);
    if (error) return status("manageStatus", error.message, "error");
    if (item.storage_path) {
      const { error: storageError } = await client.storage.from("teaching-files").remove([item.storage_path]);
      if (storageError) console.error("Resource record removed but file cleanup failed", storageError);
    }
    status("manageStatus", "تم الحذف.", "ok");
    await refreshAdminList();
  }

  $("settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!state.admin) return status("settingsStatus", "سجّل الدخول بحساب مدير.", "error");
    const number = $("whatsappNumber").value.replace(/\D/g, "");
    if (number.length < 8 || number.length > 15) return status("settingsStatus", "راجع رقم واتساب ومفتاح الدولة.", "error");
    const { error } = await client.from("site_settings").upsert({
      key: "whatsapp", value: number, updated_at: new Date().toISOString()
    });
    if (error) return status("settingsStatus", error.message, "error");
    setWhatsApp(number);
    status("settingsStatus", "تم حفظ رقم واتساب.", "ok");
  });

  $("menuBtn").addEventListener("click", () => $("navLinks").classList.toggle("open"));
  $("navLinks").querySelectorAll("a").forEach(a => a.addEventListener("click", () => $("navLinks").classList.remove("open")));
  $("year").textContent = new Date().getFullYear();
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
  }), { threshold: .12 });
  document.querySelectorAll(".reveal").forEach(el => observer.observe(el));

  async function init() {
    handleHash();
    if (!client) {
      await loadPublic();
      if (location.hash === "#admin") status("loginStatus", "أكمل إعداد config.js واتبع README لتوصيل Supabase.", "error");
      return;
    }
    const { data: { session } } = await client.auth.getSession();
    if (session) await verifyAdmin(session);
    client.auth.onAuthStateChange((_event, session) => {
      // Defer queries to avoid running Supabase requests inside the auth callback.
      setTimeout(() => verifyAdmin(session), 0);
    });
    await loadPublic();
  }
  init();
})();