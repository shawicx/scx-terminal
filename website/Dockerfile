# ============================================================
# @description scx-terminal 官网 Dockerfile（纯静态，无构建步骤）
# 直接以 nginx:alpine 托管 website/ 目录下的静态文件
# ============================================================

FROM nginx:alpine

# 复制静态站点文件
COPY index.html en/ style.css main.js /usr/share/nginx/html/

# 复制 nginx 配置（纯静态托管）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 6901

CMD ["nginx", "-g", "daemon off;"]
