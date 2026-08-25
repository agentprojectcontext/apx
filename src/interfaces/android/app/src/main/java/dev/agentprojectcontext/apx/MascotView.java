package dev.agentprojectcontext.apx;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;

final class MascotView extends View {
    interface Listener {
        void onDragStarted();
        void onMove(float rawX, float rawY, float offsetX, float offsetY);
        void onDragEnded(boolean cancelled);
        void onTapped();
    }

    private Bitmap body;
    private MascotBlobCatalog.Preset preset;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private String message;
    private Runnable hideMessage;
    private float downRawX;
    private float downRawY;
    private float offsetX;
    private float offsetY;
    private boolean dragged;
    private boolean dragging;
    private long hopStarted;

    MascotView(Context context, String avatar, Listener listener) {
        super(context);
        this.listener = listener;
        setAvatar(avatar);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(dp(12.5f));
        textPaint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL));
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    void setAvatar(String key) {
        MascotBlobCatalog.Preset next = MascotBlobCatalog.forKey(key);
        Bitmap nextBody = BitmapFactory.decodeResource(getResources(), next.drawable);
        if (nextBody == null) return;
        preset = next;
        body = nextBody;
        invalidate();
    }

    void showMessage(String value) {
        message = value == null ? null : value.trim();
        if (message == null || message.isEmpty()) return;
        hopStarted = System.currentTimeMillis();
        if (hideMessage != null) handler.removeCallbacks(hideMessage);
        long duration = Math.min(9_000, Math.max(3_500, 1_500 + message.length() * 45L));
        hideMessage = () -> {
            message = null;
            invalidate();
        };
        handler.postDelayed(hideMessage, duration);
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long now = System.currentTimeMillis();
        float width = getWidth();
        float bodySize = dp(122);
        float walk = dragging ? 0 : (float) (dp(13) * Math.sin(now / 1_035.0));
        float bob = dragging ? -dp(20) : (float) (-dp(7) * (0.5 + 0.5 * Math.sin(now / 780.0)));
        long hopAge = now - hopStarted;
        float hop = hopAge >= 0 && hopAge < 520 ? (float) (-dp(16) * Math.sin(Math.PI * hopAge / 260.0) * (1.0 - hopAge / 700.0)) : 0;
        float left = (width - bodySize) / 2f + walk;
        float top = getHeight() - bodySize - dp(7) + bob + hop;

        paint.setColor(0x50000000);
        float shadowInset = dragging ? dp(34) : dp(24);
        int shadowAlpha = dragging ? 0x28000000 : 0x50000000;
        paint.setColor(shadowAlpha);
        canvas.drawOval(new RectF(left + shadowInset, getHeight() - dp(17), left + bodySize - shadowInset, getHeight() - dp(5)), paint);

        float tilt = dragging
            ? (float) (13 + 4 * Math.sin(now / 125.0))
            : (float) (3 * Math.sin(now / 780.0));
        canvas.save();
        canvas.rotate(tilt, left + bodySize / 2f, top + bodySize * 0.88f);
        paint.setColor(Color.WHITE);
        canvas.drawBitmap(body, null, new RectF(left, top, left + bodySize, top + bodySize), paint);
        drawEyes(canvas, left, top, bodySize, now);
        canvas.restore();
        if (message != null) drawBubble(canvas, message, top - dp(8));
        postInvalidateDelayed(32);
    }

    private void drawEyes(Canvas canvas, float left, float top, float size, long now) {
        if (preset == null) return;
        float scale = size / 256f;
        float look = (float) (Math.sin(now / 980.0) * 8f) * scale;
        boolean blink = now % 5_400L > 5_170L;
        float blinkScale = blink ? 0.10f : 1f;
        paint.setColor(preset.eyeColor);
        for (float[] eye : preset.eyes) {
            drawEye(
                canvas,
                left + eye[0] * scale + look,
                top + eye[1] * scale,
                eye[2] * scale,
                eye[3] * scale,
                eye[4] * scale,
                blinkScale
            );
        }
    }

    private void drawEye(Canvas canvas, float x, float y, float width, float height, float radius, float blinkScale) {
        float middle = y + height / 2f;
        float half = height * blinkScale / 2f;
        canvas.drawRoundRect(new RectF(x, middle - half, x + width, middle + half), radius, radius, paint);
    }

    private void drawBubble(Canvas canvas, String value, float bottom) {
        float margin = dp(8);
        float padding = dp(11);
        float maxWidth = getWidth() - margin * 2;
        String[] lines = wrap(value, maxWidth - padding * 2);
        float lineHeight = dp(17);
        float height = padding * 2 + lines.length * lineHeight;
        float top = Math.max(dp(2), bottom - height);
        RectF bubble = new RectF(margin, top, getWidth() - margin, bottom);
        paint.setColor(0xEE14181C);
        paint.setShadowLayer(dp(12), 0, dp(6), 0x77000000);
        canvas.drawRoundRect(bubble, dp(14), dp(14), paint);
        paint.clearShadowLayer();
        Path tail = new Path();
        tail.moveTo(getWidth() / 2f - dp(8), bottom);
        tail.lineTo(getWidth() / 2f + dp(8), bottom);
        tail.lineTo(getWidth() / 2f, bottom + dp(9));
        tail.close();
        canvas.drawPath(tail, paint);
        float y = top + padding - textPaint.ascent();
        for (String line : lines) {
            canvas.drawText(line, margin + padding, y, textPaint);
            y += lineHeight;
        }
    }

    private String[] wrap(String value, float maxWidth) {
        java.util.ArrayList<String> lines = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String word : value.split("\\s+")) {
            String candidate = current.length() == 0 ? word : current + " " + word;
            if (textPaint.measureText(candidate) <= maxWidth || current.length() == 0) {
                current.setLength(0);
                current.append(candidate);
            } else {
                lines.add(current.toString());
                current.setLength(0);
                current.append(word);
            }
            if (lines.size() == 3) break;
        }
        if (current.length() > 0 && lines.size() < 4) lines.add(current.toString());
        return lines.toArray(new String[0]);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                offsetX = event.getX();
                offsetY = event.getY();
                dragged = false;
                dragging = true;
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!dragged && Math.hypot(event.getRawX() - downRawX, event.getRawY() - downRawY) > dp(6)) {
                    dragged = true;
                    listener.onDragStarted();
                }
                listener.onMove(event.getRawX(), event.getRawY(), offsetX, offsetY);
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                invalidate();
                if (dragged) listener.onDragEnded(event.getActionMasked() == MotionEvent.ACTION_CANCEL);
                else {
                    hopStarted = System.currentTimeMillis();
                    listener.onTapped();
                }
                return true;
            default:
                return super.onTouchEvent(event);
        }
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }
}
