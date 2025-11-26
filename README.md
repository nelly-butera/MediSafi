# MedSafi - Medication Information Lookup

**Demo Video**: [to be added]  
**Live Site**: (http://3.87.160.166/)

A web application that provides easy access to FDA adverse event data, helping users make informed decisions about medications. Built with vanilla JavaScript and Node.js, deployed with load balancing.

## What It Does

MedSafi lets you search for any medication and see real-world data from the FDA's adverse event database. You can view:
- Common uses and indications
- Reported adverse reactions with statistics
- Total number of reports filed
- Percentage breakdowns of side effects

All data comes directly from the FDA's public API spanning from 2004 to present.

## Quick Start

### Running Locally

1. **Clone the repo**
```bash
git clone <your-repo-url>
cd medsafi
```

2. **Start the backend** (optional - app works without it)
```bash
cd backend
npm install
node server.js
```

3. **Open the app**
Simply open `index.html` in your browser. That's it! The app connects directly to the FDA API, so no backend is needed for basic functionality.

Try searching for: paracetamol, ibuprofen, aspirin, metformin, or lipitor.

## Features

- **Fast autocomplete** - Suggestions appear as you type with report counts
- **Real FDA data** - All information comes from actual adverse event reports
- **Detailed statistics** - See how many people reported each side effect
- **Clean interface** - Easy to read, mobile-friendly design
- **Recent searches** - Keeps track of your last 5 searches
- **No login required** - Just search and go

## How I Built It

### Tech Stack
- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js + Express (for deployment)
- API: FDA Adverse Event Reporting System (openFDA)
- Deployment: Nginx load balancer with PM2

### Why These Choices?
I went with vanilla JavaScript instead of a framework because the app is fairly straightforward and I wanted to keep it lightweight. The FDA API is public and doesn't require authentication, which makes it perfect for this use case. For deployment, I used PM2 to keep the backend running and Nginx to balance traffic between servers.

### API Integration
The app uses two main FDA endpoints:
1. `drug/event.json?count=patient.drug.medicinalproduct.exact` - For autocomplete
2. `drug/event.json?count=patient.drug.drugindication.exact` - For indications
3. `drug/event.json?count=patient.reaction.reactionmeddrapt.exact` - For reactions

I chose these endpoints because they return aggregated data quickly. The full event reports were too slow and contained more detail than needed for a quick lookup tool.

## Deployment Instructions

I deployed this on three servers: two web servers (Web01, Web02) and one load balancer (Lb01).

### Step 1: Deploy Backend to Web Servers

On both Web01 and Web02:

```bash
# Upload files
scp -r backend/ user@web01:/var/www/medsafi/backend/

# SSH into server
ssh user@web01

# Install dependencies and start with PM2
cd /var/www/medsafi/backend
npm install
pm2 start server.js --name medsafi
pm2 save
pm2 startup
```

### Step 2: Configure Load Balancer

On Lb01:

```bash
# Upload frontend files
scp -r index.html style.css app.js user@lb01:/var/www/medsafi/

# Create Nginx config
sudo nano /etc/nginx/sites-available/medsafi
```

Add this configuration:

```nginx
upstream medsafi_backend {
    least_conn;
    server WEB01_IP:3000;
    server WEB02_IP:3000;
}

server {
    listen 80;
    server_name your_domain_or_ip;

    location / {
        root /var/www/medsafi;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://medsafi_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable and restart
sudo ln -s /etc/nginx/sites-available/medsafi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 3: Testing

```bash
# Test load balancer health
curl http://your_lb_ip/

# Test API routing
curl http://your_lb_ip/api/health

# Check both servers are receiving requests
pm2 logs medsafi  # Run on both web servers
```

## Challenges I Ran Into

**Slow loading times** - Initially I was fetching full adverse event reports (100 records each) which took 5-8 seconds. Switched to using count endpoints instead which reduced load time to under 2 seconds.

**Autocomplete performance** - First version fetched full event data for autocomplete, causing 3-4 second delays. Fixed by using the count API endpoint which only returns drug names and counts.

**Missing drug data** - Some common drugs weren't in the label database. Solved by switching entirely to the adverse events database which has much better coverage.

**CORS issues** - The FDA API allows direct browser requests so no proxy needed, but I set up an optional backend for future rate limiting.

## API Credits

- **Data Source**: [openFDA Drug Adverse Events API](https://open.fda.gov/apis/drug/event/)
- **Provider**: U.S. Food and Drug Administration
- **License**: Public domain, no API key required
- **Data Range**: 2004 - Present

## Project Structure

```
medsafi/
├── backend/
│   ├── server.js
│   ├── .env
│   ├── package.json
│   └── .gitignore
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── README.md
```

## Future Improvements

If I had more time, I'd add:
- Drug comparison feature (compare side effects of similar drugs)
- Data visualization charts for adverse reactions
- Export results to PDF
- User accounts to save favorite searches
- More detailed filtering options



