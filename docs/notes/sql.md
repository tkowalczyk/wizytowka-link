# Geocoder (hourly)
                                                                                                                                                       
```sql 
  -- ogólny postęp geocodingu
  SELECT                                                                                                                                                                                 
    COUNT(*) AS total,                                                                                                                                                                   
    SUM(lat IS NOT NULL) AS geocoded,                                                                                                                                                    
    SUM(geocode_failed = 1) AS failed,                                                                                                                                                   
    SUM(lat IS NULL AND geocode_failed = 0) AS remaining
  FROM localities;
```

```sql
  -- ostatnie geocodowane (czy cron działa?)
  SELECT name, voivodeship, lat, lng, distance_km
  FROM localities WHERE lat IS NOT NULL
  ORDER BY rowid DESC LIMIT 10;
```

#  Scraper (daily 8:00)

```sql
  -- postęp scrapowania
  SELECT
    SUM(searched_at IS NOT NULL) AS searched,
    SUM(searched_at IS NULL AND lat IS NOT NULL) AS ready_to_search,
    SUM(lat IS NULL) AS waiting_for_geocode
  FROM localities;
```

```sql
  -- ile biznesów per dzień
  SELECT DATE(created_at) AS day, COUNT(*) AS new_businesses
  FROM businesses
  GROUP BY day ORDER BY day DESC LIMIT 7;
```

```sql
  -- ostatnie scrapowane miejscowości
  SELECT name, searched_at
  FROM localities WHERE searched_at IS NOT NULL
  ORDER BY searched_at DESC LIMIT 10;
```
  
# Generator (co 5 min)

```sql
  -- postęp generowania stron
  SELECT
    COUNT(*) AS total_businesses,
    SUM(site_generated = 1) AS generated,
    SUM(website IS NULL AND phone IS NOT NULL AND site_generated = 0) AS queued,
    SUM(website IS NOT NULL) AS has_own_website
  FROM businesses;
```

```sql
  -- ostatnio wygenerowane
  SELECT b.title, l.name AS locality, b.created_at
  FROM businesses b JOIN localities l ON b.locality_id = l.id
  WHERE b.site_generated = 1
  ORDER BY b.rowid DESC LIMIT 10;
```
  
# Jedno zapytanie "dashboard"

```sql
  SELECT
    (SELECT COUNT(*) FROM localities WHERE lat IS NOT NULL) || '/' || (SELECT COUNT(*) FROM localities) AS geocoded,
    (SELECT COUNT(*) FROM localities WHERE searched_at IS NOT NULL) || '/' || (SELECT COUNT(*) FROM localities WHERE lat IS NOT NULL) AS scraped,
    (SELECT SUM(site_generated) FROM businesses) || '/' || (SELECT COUNT(*) FROM businesses WHERE website IS NULL AND phone IS NOT NULL) AS sites_generated,
    (SELECT COUNT(*) FROM businesses) AS total_biz;
```