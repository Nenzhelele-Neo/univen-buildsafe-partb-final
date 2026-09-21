# UNIVEN BuildSafe

BuildSafe is a campus construction-awareness system for viewing projects, publishing notices, reporting hazards, and planning safer routes around the University of Venda campus.

## Requirements

- Node.js
- npm
- Internet connection for OpenStreetMap/Leaflet map tiles

## Setup

1. Clone or download the repository.
2. Open a terminal in the project folder.
3. Enter the backend folder:

   ```bash
   cd backend
   ```

4. Install dependencies:

   ```bash
   npm install
   ```

   This installs all required packages, including the image-upload dependency.

5. Start the application:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000` in a browser.

## Demo Login

- Admin: `admin@univen.ac.za` / `admin123`
- Student: `student@univen.ac.za` / `student123`

## Main Features

- Admin and Student login
- Construction project management and map markers
- Safe-route planning for walking and vehicles
- Construction-aware alternate routes
- Student and staff issue reports
- Admin report approval, editing, publishing, and rejection
- Optional report photo upload
- Known campus location selection and exact campus point picker
- Campus notices

## Data Storage

- Application JSON data is stored under `backend/data/`.
- Uploaded report images are stored locally under `backend/uploads/`.
- Runtime-uploaded images are intentionally excluded from Git.
- `backend/uploads/.gitkeep` preserves the upload folder after cloning.

Data is local to each running copy of the project. No MySQL database is required.

## Map Note

Campus route guidance may use approximate mapped locations and may not reflect temporary access changes.

## Project Structure

```text
backend/
  data/
  uploads/
  server.js

frontend/
  css/
  js/
  *.html
```
