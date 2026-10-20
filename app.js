(() => {
  "use strict";

  // ========================================
  // Supabase setup
  // ========================================

  const cfg = window.SUPABASE_CONFIG || {};

  const configured = Boolean(
    cfg.url &&
    cfg.anonKey &&
    !cfg.url.includes("YOUR-PROJECT") &&
    !cfg.anonKey.includes("YOUR_SUPABASE"),
  );

  const supabaseLib = window.supabase;

  const client =
    configured && supabaseLib
      ? supabaseLib.createClient(cfg.url, cfg.anonKey)
      : null;

  const $ = (id) => document.getElementById(id);

  const BUCKET = "teaching-files";
  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  const state = {
    session: null,
    admin: false,
    resources: [],
    deleting: false,
  };

  const overlay = $("adminOverlay");

  const contentNames = {
    file: "فيديو",
    note: "مذكرة أو ملف",
    link: "رابط",
  };

  // ========================================
  // Helpers
  // ========================================

  function status(id, message, type = "") {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.className = "status" + (type ? " " + type : "");
  }

  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());

      if (!["https:", "http:"].includes(parsed.protocol)) {
        return null;
      }

      return parsed.href;
    } catch {
      return null;
    }
  }

  function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ar-EG");
  }

  function setLoadingButtons(form, loading) {
    if (!form) return;

    form.querySelectorAll('button[type="submit"]').forEach((button) => {
      if (loading) {
        if (!button.dataset.originalText) {
          button.dataset.originalText = button.textContent;
        }

        button.disabled = true;
        button.textContent = "جاري التنفيذ...";
      } else {
        button.disabled = false;

        if (button.dataset.originalText) {
          button.textContent = button.dataset.originalText;
          delete button.dataset.originalText;
        }
      }
    });
  }

  function showEmpty(container, message) {
    if (!container) return;

    container.innerHTML = `<div class="empty">${esc(message)}</div>`;
  }

  function uniqueId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getExtension(filename) {
    const match = String(filename || "").match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : "";
  }

  function validateUpload(file) {
    if (!file) {
      return "اختر ملفًا أولًا.";
    }

    const allowedExtensions = [
      "pdf",
      "doc",
      "docx",
      "ppt",
      "pptx",
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "avif",
    ];

    const extension = getExtension(file.name);

    if (!allowedExtensions.includes(extension)) {
      return "الملفات المسموحة: PDF وWord وPowerPoint والصور.";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "حجم الملف أكبر من 20MB.";
    }

    if (file.size === 0) {
      return "الملف فارغ، اختر ملفًا آخر.";
    }

    return "";
  }

  // استخدم اسمًا بسيطًا وآمنًا في Storage بدل اسم الملف العربي.
  // هذا يساعد على تجنب مشاكل مفاتيح التخزين Invalid key.
  function makeStoragePath(file) {
    const userId = state.session?.user?.id;

    if (!userId) {
      throw new Error("تعذر تحديد المستخدم المسجل.");
    }

    const extension = getExtension(file.name);

    return `${userId}/${uniqueId()}.${extension}`;
  }

  // ========================================
  // Admin overlay
  // ========================================

  function openAdmin() {
    if (!overlay) return;

    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    renderAdminState();
  }

  function closeAdmin() {
    if (!overlay) return;

    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  function handleHash() {
    if (location.hash === "#admin") {
      openAdmin();
    } else {
      closeAdmin();
    }
  }

  window.addEventListener("hashchange", handleHash);

  $("closeAdmin")?.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);

    closeAdmin();
  });

  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) closeAdmin();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAdmin();
  });

  function renderAdminState() {
    $("loginPanel")?.classList.toggle("hidden", state.admin);
    $("dashboard")?.classList.toggle("hidden", !state.admin);

    if ($("signedInAs") && state.session?.user?.email) {
      $("signedInAs").textContent = state.session.user.email;
    }
  }

  // ========================================
  // WhatsApp
  // ========================================

  function setWhatsApp(number) {
    const clean = String(number || "").replace(/\D/g, "");
    const url = clean ? `https://wa.me/${clean}` : "https://wa.me/";

    ["topWhatsApp", "socialWhatsApp", "contactWhatsApp"].forEach((id) => {
      const element = $(id);

      if (element) {
        element.href = url;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
      }
    });
  }

  async function loadWhatsApp() {
    if (!client) return;

    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", "whatsapp")
      .maybeSingle();

    if (error) {
      console.error("تعذر تحميل إعدادات واتساب:", error);
      return;
    }

    if (data?.value) {
      setWhatsApp(data.value);
    }
  }

  // ========================================
  // Storage URL helpers
  // ========================================

  function getPublicFileUrl(path) {
    if (!client || !path) return null;

    try {
      const { data } = client.storage.from(BUCKET).getPublicUrl(path);

      return safeUrl(data?.publicUrl);
    } catch (error) {
      console.error("تعذر إنشاء رابط الملف:", error);
      return null;
    }
  }

  function getResourceUrl(item) {
    // استخدم الرابط المحفوظ أولًا.
    const savedUrl = safeUrl(item.url);

    if (savedUrl) {
      return savedUrl;
    }

    // محاولة استعادة رابط الملفات القديمة من مسار التخزين.
    if (item.storage_path) {
      return getPublicFileUrl(item.storage_path);
    }

    return null;
  }

  // ========================================
  // Public content rendering
  // ========================================

  function renderResourceItem(item) {
    const url = getResourceUrl(item);

    if (!url) {
      return `
        <div class="resource-item">
          <div>
            <strong>${esc(item.title || "محتوى بدون عنوان")}</strong>
            <small>تعذر إنشاء رابط المحتوى. راجع إعدادات التخزين.</small>
          </div>
        </div>
      `;
    }

    const isLink = item.kind === "link";
    const isNote = item.kind === "note";

    const description =
      item.description ||
      (isLink ? "رابط خارجي" : isNote ? "مذكرة أو ملف تعليمي" : "فيديو شرح");

    const buttonText = isLink
      ? "فتح الرابط ↗"
      : isNote
        ? "فتح / تحميل ↗"
        : "مشاهدة الفيديو ↗";

    const isImage = /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(url);

    const imagePreview =
      isNote && isImage
        ? `
        <a
          href="${esc(url)}"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="عرض الصورة"
        >
          <img
            src="${esc(url)}"
            alt="${esc(item.title || "صورة تعليمية")}"
            loading="lazy"
            style="max-width:100%;max-height:180px;object-fit:contain;border-radius:10px;margin-top:10px"
            onerror="this.style.display='none'"
          />
        </a>
      `
        : "";

    return `
      <div class="resource-item">
        <div>
          <strong>${esc(item.title || "بدون عنوان")}</strong>
          <small>${esc(description)}</small>
          ${imagePreview}
        </div>

        <a
          class="btn"
          href="${esc(url)}"
          target="_blank"
          rel="noopener noreferrer"
        >${buttonText}</a>
      </div>
    `;
  }

  function renderPublic() {
    const categories = [
      {
        kind: "file",
        containerId: "filesList",
        emptyText: "لا توجد فيديوهات مضافة حاليًا.",
      },
      {
        kind: "note",
        containerId: "notesList",
        emptyText: "لا توجد مذكرات أو ملفات مضافة حاليًا.",
      },
      {
        kind: "link",
        containerId: "linksList",
        emptyText: "لا توجد روابط مضافة حاليًا.",
      },
    ];

    categories.forEach(({ kind, containerId, emptyText }) => {
      const container = $(containerId);

      if (!container) return;

      const items = state.resources.filter((item) => item.kind === kind);

      if (!items.length) {
        showEmpty(container, emptyText);
        return;
      }

      container.innerHTML = items.map(renderResourceItem).join("");
    });

    // تحديث عداد الفيديوهات إن كان موجودًا في التصميم.
    // عداد إجمالي المحتوى المنشور
    const videoCount = $("videoCount");

    if (videoCount) {
      videoCount.textContent = String(state.resources.length);
    }
  }

  async function loadPublic() {
    if (!client) {
      [
        ["filesList", "أضف إعدادات Supabase لإظهار الفيديوهات."],
        ["notesList", "أضف إعدادات Supabase لإظهار المذكرات."],
        ["linksList", "أضف إعدادات Supabase لإظهار الروابط."],
      ].forEach(([id, message]) => {
        showEmpty($(id), message);
      });

      if ($("publicStatus")) {
        $("publicStatus").textContent =
          "يجب إعداد config.js وربط الموقع بمشروع Supabase.";
      }

      return;
    }

    if ($("publicStatus")) {
      $("publicStatus").textContent = "جاري تحميل المحتوى...";
    }

    const { data, error } = await client
      .from("site_resources")
      .select("id,title,description,kind,url,storage_path,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("خطأ تحميل المحتوى:", error);

      [
        ["filesList", "تعذر تحميل الفيديوهات."],
        ["notesList", "تعذر تحميل المذكرات."],
        ["linksList", "تعذر تحميل الروابط."],
      ].forEach(([id, message]) => {
        showEmpty($(id), message);
      });

      if ($("publicStatus")) {
        $("publicStatus").textContent =
          "تعذر تحميل المحتوى. راجع اتصال Supabase وصلاحيات القراءة.";
      }

      return;
    }

    state.resources = data || [];

    renderPublic();
    await loadWhatsApp();

    if ($("publicStatus")) {
      $("publicStatus").textContent = "";
    }
  }

  // ========================================
  // Admin content management
  // ========================================

  async function refreshAdminList() {
    if (!client || !state.admin) return;

    const box = $("manageList");

    if (!box) return;

    showEmpty(box, "جاري تحميل المحتوى...");

    const { data, error } = await client
      .from("site_resources")
      .select("id,title,description,kind,url,storage_path,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("خطأ تحميل لوحة الإدارة:", error);

      showEmpty(box, "تعذر تحميل المحتوى.");

      status(
        "manageStatus",
        "تعذر تحميل المحتوى. راجع صلاحيات جدول site_resources.",
        "error",
      );

      return;
    }

    state.resources = data || [];
    renderPublic();

    if (!state.resources.length) {
      showEmpty(box, "لا يوجد محتوى حاليًا. أضف فيديو أو مذكرة أو رابطًا.");
      status("manageStatus", "");
      return;
    }

    box.innerHTML = state.resources
      .map((item) => {
        const name = contentNames[item.kind] || "محتوى";
        const date = formatDate(item.created_at);

        return `
        <div class="admin-row">
          <div>
            <strong>${esc(item.title || "بدون عنوان")}</strong>
            <small>${esc(name)}${date ? " · " + esc(date) : ""}</small>
          </div>

          <button
            class="btn danger"
            data-delete="${esc(item.id)}"
            type="button"
          >حذف</button>
        </div>
      `;
      })
      .join("");

    box.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        deleteResource(button.dataset.delete);
      });
    });

    status("manageStatus", "");
  }

  // ========================================
  // Admin verification
  // ========================================

  async function verifyAdmin(session) {
    if (!client || !session?.user) {
      state.session = null;
      state.admin = false;
      renderAdminState();
      return;
    }

    state.session = session;

    const { data, error } = await client
      .from("site_admins")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    state.admin = Boolean(data && !error);

    renderAdminState();

    if (state.admin) {
      await refreshAdminList();

      const { data: setting, error: settingError } = await client
        .from("site_settings")
        .select("value")
        .eq("key", "whatsapp")
        .maybeSingle();

      if (settingError) {
        console.error("تعذر تحميل رقم واتساب:", settingError);
      }

      if ($("whatsappNumber")) {
        $("whatsappNumber").value = setting?.value || "";
      }
    } else if (location.hash === "#admin") {
      status(
        "loginStatus",
        "الحساب غير مسجل كمدير في جدول site_admins.",
        "error",
      );

      await client.auth.signOut();

      state.session = null;
      renderAdminState();
    }
  }

  // ========================================
  // Login and logout
  // ========================================

  $("loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!client) {
      status("loginStatus", "أكمل إعداد config.js أولًا.", "error");
      return;
    }

    const form = $("loginForm");

    setLoadingButtons(form, true);
    status("loginStatus", "جاري تسجيل الدخول...");

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value,
      });

      if (error) {
        status("loginStatus", error.message, "error");
        return;
      }

      await verifyAdmin(data.session);

      if (state.admin) {
        status("loginStatus", "تم تسجيل الدخول بنجاح.", "ok");
      }
    } catch (error) {
      console.error(error);
      status("loginStatus", "حدث خطأ أثناء تسجيل الدخول.", "error");
    } finally {
      setLoadingButtons(form, false);
    }
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    if (client) {
      const { error } = await client.auth.signOut();

      if (error) {
        status("manageStatus", error.message, "error");
        return;
      }
    }

    state.session = null;
    state.admin = false;

    renderAdminState();
    status("loginStatus", "تم تسجيل الخروج.", "ok");
  });

  // ========================================
  // Admin tabs
  // ========================================

  document.querySelectorAll(".admin-tabs button").forEach((button) => {
    button.addEventListener("click", async () => {
      const selectedTab = button.dataset.tab;

      document.querySelectorAll(".admin-tabs button").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });

      ["file", "note", "link", "manage", "settings"].forEach((tab) => {
        $("tab-" + tab)?.classList.toggle("hidden", tab !== selectedTab);
      });

      if (selectedTab === "manage") {
        await refreshAdminList();
      }
    });
  });

  // ========================================
  // Upload note / image / document
  // Requires noteForm, noteTitle, noteUpload,
  // noteDescription, noteStatus in index.html.
  // ========================================

  $("noteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!client || !state.admin || !state.session?.user) {
      status("noteStatus", "سجّل الدخول بحساب مدير أولًا.", "error");
      return;
    }

    const form = $("noteForm");
    const file = $("noteUpload")?.files?.[0];

    const validationError = validateUpload(file);

    if (validationError) {
      status("noteStatus", validationError, "error");
      return;
    }

    const title = $("noteTitle")?.value.trim() || "";
    const description = $("noteDescription")?.value.trim() || "";

    if (!title) {
      status("noteStatus", "اكتب عنوان المذكرة أو الملف.", "error");
      return;
    }

    setLoadingButtons(form, true);
    status("noteStatus", "جاري رفع الملف...");

    let uploadedPath = null;

    try {
      const path = makeStoragePath(file);

      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });

      if (uploadError) {
        throw uploadError;
      }

      uploadedPath = path;

      const publicUrl = getPublicFileUrl(path);

      if (!publicUrl) {
        throw new Error(
          "تم رفع الملف لكن تعذر إنشاء رابطه. تحقق من إعدادات Storage.",
        );
      }

      const { error: insertError } = await client
        .from("site_resources")
        .insert({
          title,
          description,
          kind: "note",
          url: publicUrl,
          storage_path: path,
        });

      if (insertError) {
        throw insertError;
      }

      form.reset();

      status("noteStatus", "تم نشر الملف بنجاح.", "ok");

      await loadPublic();
      await refreshAdminList();
    } catch (error) {
      console.error("خطأ نشر المذكرة أو الملف:", error);

      // حذف الملف من Storage إذا فشل حفظ سجل قاعدة البيانات.
      if (uploadedPath) {
        const { error: cleanupError } = await client.storage
          .from(BUCKET)
          .remove([uploadedPath]);

        if (cleanupError) {
          console.error("تعذر تنظيف الملف بعد فشل النشر:", cleanupError);
        }
      }

      status(
        "noteStatus",
        error.message || "حدث خطأ أثناء رفع الملف.",
        "error",
      );
    } finally {
      setLoadingButtons(form, false);
    }
  });

  // ========================================
  // Publish video by URL
  // fileForm uses fileTitle, fileUpload (URL),
  // fileDescription and fileStatus.
  // ========================================

  $("fileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!client || !state.admin || !state.session?.user) {
      status("fileStatus", "سجّل الدخول بحساب مدير أولًا.", "error");
      return;
    }

    const form = $("fileForm");
    const title = $("fileTitle")?.value.trim() || "";
    const url = safeUrl($("fileUpload")?.value);
    const description = $("fileDescription")?.value.trim() || "";

    if (!title) {
      status("fileStatus", "اكتب عنوان الفيديو.", "error");
      return;
    }

    if (!url) {
      status(
        "fileStatus",
        "أدخل رابط فيديو صحيحًا يبدأ بـ https:// أو http://.",
        "error",
      );
      return;
    }

    setLoadingButtons(form, true);
    status("fileStatus", "جاري نشر الفيديو...");

    try {
      const { error } = await client.from("site_resources").insert({
        title,
        description,
        kind: "file",
        url,
        storage_path: null,
      });

      if (error) throw error;

      form.reset();

      status("fileStatus", "تم نشر الفيديو بنجاح.", "ok");

      await loadPublic();
      await refreshAdminList();
    } catch (error) {
      console.error("خطأ نشر الفيديو:", error);

      status("fileStatus", error.message || "تعذر نشر الفيديو.", "error");
    } finally {
      setLoadingButtons(form, false);
    }
  });

  // ========================================
  // Add external link
  // ========================================

  $("linkForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!client || !state.admin) {
      status("linkStatus", "سجّل الدخول بحساب مدير أولًا.", "error");
      return;
    }

    const form = $("linkForm");
    const title = $("linkTitle")?.value.trim() || "";
    const url = safeUrl($("linkUrl")?.value);
    const description = $("linkDescription")?.value.trim() || "";

    if (!title) {
      status("linkStatus", "اكتب اسم الرابط.", "error");
      return;
    }

    if (!url) {
      status(
        "linkStatus",
        "أدخل رابطًا صحيحًا يبدأ بـ https:// أو http://.",
        "error",
      );
      return;
    }

    setLoadingButtons(form, true);
    status("linkStatus", "جاري حفظ الرابط...");

    try {
      const { error } = await client.from("site_resources").insert({
        title,
        description,
        kind: "link",
        url,
        storage_path: null,
      });

      if (error) throw error;

      form.reset();

      status("linkStatus", "تم حفظ الرابط ونشره بنجاح.", "ok");

      await loadPublic();
      await refreshAdminList();
    } catch (error) {
      console.error("خطأ إضافة الرابط:", error);

      status("linkStatus", error.message || "تعذر حفظ الرابط.", "error");
    } finally {
      setLoadingButtons(form, false);
    }
  });

  // ========================================
  // Delete content
  // ========================================

  async function deleteResource(id) {
    if (!client || !state.admin || state.deleting) return;

    const item = state.resources.find(
      (resource) => String(resource.id) === String(id),
    );

    if (!item) {
      status("manageStatus", "لم يتم العثور على المحتوى.", "error");
      return;
    }

    const confirmed = confirm(`متأكد إنك عايز تحذف "${item.title}"؟`);

    if (!confirmed) return;

    state.deleting = true;
    status("manageStatus", "جاري حذف المحتوى...");

    try {
      // احذف الملف من Storage أولًا، حتى لا نحذف سجل قاعدة البيانات
      // ونترك الملف إذا فشلت عملية التخزين.
      if (item.storage_path) {
        const { error: storageError } = await client.storage
          .from(BUCKET)
          .remove([item.storage_path]);

        if (storageError) {
          throw storageError;
        }
      }

      const { error: databaseError } = await client
        .from("site_resources")
        .delete()
        .eq("id", id);

      if (databaseError) {
        throw databaseError;
      }

      state.resources = state.resources.filter(
        (resource) => String(resource.id) !== String(id),
      );

      renderPublic();

      status("manageStatus", "تم حذف المحتوى بنجاح.", "ok");

      await loadPublic();
      await refreshAdminList();
    } catch (error) {
      console.error("خطأ حذف المحتوى:", error);

      status("manageStatus", error.message || "تعذر حذف المحتوى.", "error");

      await refreshAdminList();
    } finally {
      state.deleting = false;
    }
  }

  // ========================================
  // WhatsApp settings
  // ========================================

  $("settingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!client || !state.admin) {
      status("settingsStatus", "سجّل الدخول بحساب مدير أولًا.", "error");
      return;
    }

    const form = $("settingsForm");
    const number = $("whatsappNumber")?.value.replace(/\D/g, "") || "";

    if (number.length < 8 || number.length > 15) {
      status("settingsStatus", "راجع رقم واتساب ومفتاح الدولة.", "error");
      return;
    }

    setLoadingButtons(form, true);
    status("settingsStatus", "جاري حفظ الرقم...");

    try {
      const { error } = await client.from("site_settings").upsert({
        key: "whatsapp",
        value: number,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      setWhatsApp(number);

      status("settingsStatus", "تم حفظ رقم واتساب بنجاح.", "ok");
    } catch (error) {
      console.error("خطأ حفظ واتساب:", error);

      status(
        "settingsStatus",
        error.message || "تعذر حفظ رقم واتساب.",
        "error",
      );
    } finally {
      setLoadingButtons(form, false);
    }
  });

  // ========================================
  // Mobile menu and animations
  // ========================================

  $("menuBtn")?.addEventListener("click", () => {
    $("navLinks")?.classList.toggle("open");
  });

  $("navLinks")
    ?.querySelectorAll("a")
    .forEach((link) => {
      link.addEventListener("click", () => {
        $("navLinks")?.classList.remove("open");
      });
    });

  if ($("year")) {
    $("year").textContent = new Date().getFullYear();
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    document.querySelectorAll(".reveal").forEach((element) => {
      observer.observe(element);
    });
  } else {
    document.querySelectorAll(".reveal").forEach((element) => {
      element.classList.add("visible");
    });
  }

  // ========================================
  // Initialize
  // ========================================

  async function init() {
    handleHash();

    if (!client) {
      await loadPublic();

      if (location.hash === "#admin") {
        status(
          "loginStatus",
          "أكمل إعداد config.js لربط الموقع بـ Supabase.",
          "error",
        );
      }

      return;
    }

    try {
      const { data, error } = await client.auth.getSession();

      if (error) {
        console.error("تعذر التحقق من الجلسة:", error);
      }

      if (data?.session) {
        await verifyAdmin(data.session);
      }

      client.auth.onAuthStateChange((_event, session) => {
        // تأجيل الطلبات لتجنب تنفيذ استعلامات داخل callback المصادقة.
        Promise.resolve().then(() => verifyAdmin(session));
      });

      await loadPublic();
    } catch (error) {
      console.error("خطأ بدء التطبيق:", error);

      if ($("publicStatus")) {
        $("publicStatus").textContent =
          "حدث خطأ أثناء تشغيل الموقع. راجع إعدادات Supabase.";
      }
    }
  }

  init();
})();
