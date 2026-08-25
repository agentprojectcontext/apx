import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = (...parts) => path.join(ROOT, "src", "interfaces", "android", "app", "src", "main", ...parts);
const read = (...parts) => fs.readFileSync(android(...parts), "utf8");

test("APX declares and builds Android Auto messaging notifications", () => {
  const manifest = read("AndroidManifest.xml");
  const descriptor = read("res", "xml", "automotive_app_desc.xml");
  const notification = read("java", "dev", "agentprojectcontext", "apx", "CarMessageNotification.java");
  const activity = read("java", "dev", "agentprojectcontext", "apx", "MainActivity.java");

  assert.match(manifest, /com\.google\.android\.gms\.car\.application/);
  assert.match(manifest, /@xml\/automotive_app_desc/);
  assert.match(manifest, /android\.permission\.ACCESS_NOTIFICATION_POLICY/);
  assert.match(descriptor, /<uses name="notification"\s*\/>/);
  assert.match(notification, /NotificationCompat\.MessagingStyle/);
  assert.match(notification, /NotificationCompat\.CATEGORY_MESSAGE/);
  assert.match(notification, /RemoteInput\.Builder/);
  assert.match(notification, /SEMANTIC_ACTION_REPLY/);
  assert.match(notification, /SEMANTIC_ACTION_MARK_AS_READ/);
  assert.match(notification, /ACTION_MOBILITY_DESTINATION/);
  assert.match(notification, /Decí tu destino/);
  assert.match(notification, /setBypassDnd\(manager\.isNotificationPolicyAccessGranted\(\)\)/);
  assert.match(activity, /Probar aviso Android Auto/);
  assert.match(activity, /Permitir avisos durante conducción/);
});

test("direct APX message connection remains active without the mascot overlay", () => {
  const service = read("java", "dev", "agentprojectcontext", "apx", "MascotOverlayService.java");
  const activity = read("java", "dev", "agentprojectcontext", "apx", "MainActivity.java");

  assert.doesNotMatch(service, /!preferences\.paired\(\) \|\| !preferences\.mascotEnabled\(\)/);
  assert.match(service, /if \(socket == null\) connect\(\)/);
  assert.match(activity, /private void ensureMascotRunning\(\) \{\s*if \(!preferences\.paired\(\)\) return;/);
  assert.doesNotMatch(activity, /if \(!enabled\) \{\s*stopService/);
});

test("dragging the mascot onto the bottom target hides it", () => {
  const service = read("java", "dev", "agentprojectcontext", "apx", "MascotOverlayService.java");
  const view = read("java", "dev", "agentprojectcontext", "apx", "MascotView.java");

  assert.match(view, /listener\.onDragStarted\(\)/);
  assert.match(view, /listener\.onDragEnded\(event\.getActionMasked\(\) == MotionEvent\.ACTION_CANCEL\)/);
  assert.match(service, /Gravity\.BOTTOM \| Gravity\.CENTER_HORIZONTAL/);
  assert.match(service, /preferences\.setMascotEnabled\(false\)/);
  assert.match(service, /overDismissTarget/);
});

test("the persistent notification toggles mascot visibility", () => {
  const service = read("java", "dev", "agentprojectcontext", "apx", "MascotOverlayService.java");

  assert.match(service, /ACTION_SHOW/);
  assert.match(service, /mascotVisible \? "Ocultar mascota" : "Mostrar mascota"/);
  assert.match(service, /preferences\.setMascotEnabled\(true\)/);
  assert.match(service, /notify\(SERVICE_NOTIFICATION, serviceNotification\(\)\)/);
});
