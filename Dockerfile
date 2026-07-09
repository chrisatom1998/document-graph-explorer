# Build the production web app, then serve it with nginx.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Optional baked-in Windows portable exe (override at runtime via compose volume).
RUN mkdir -p /usr/share/nginx/downloads
COPY release/*.exe /usr/share/nginx/downloads/

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
