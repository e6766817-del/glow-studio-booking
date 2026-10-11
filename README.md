# Glow Studio – לוח תורים

מערכת ניהול תורים פנימית לקוסמטיקאית. הלקוחה מתקשרת טלפונית, והקוסמטיקאית קובעת
את התור במערכת. כל בוקר נשלח אליה מייל אוטומטי עם לוח התורים של אותו היום.

- **אתר חי:** ראו GitHub Pages של המאגר הזה.
- **אפיון מלא:** מסמך אפיון נפרד (קישור נמסר בנפרד).
- **בסיס נתונים:** Supabase (Postgres + Auth + RLS) – ראו `supabase/schema.sql`.
- **מייל יומי אוטומטי:** Supabase Edge Function + pg_cron + Resend – ראו `supabase/functions/daily-schedule-email`.

## מבנה הפרויקט

```
index.html                                   אתר הניהול (Vue 3 + supabase-js)
supabase/schema.sql                           טבלאות, נתוני זרע, RLS
supabase/schedule-cron.sql                    תזמון המייל היומי (pg_cron)
supabase/functions/daily-schedule-email/      פונקציית ה-Edge ששולחת את המייל
```

## הרצה מקומית

הקובץ `index.html` הוא עמוד סטטי יחיד (ללא build step). פותחים אותו בדפדפן, או
משרתים אותו בכל שרת סטטי. מפתח ה-Supabase ב-`index.html` הוא מפתח anon ציבורי –
בטוח לחשיפה, כל ההרשאות נאכפות ב-Row Level Security בצד השרת.
