# upload-bigFile
大文件上传之切片上传、断点续传、秒传



server文件夹中的内容为后端接口，进入server/server目录下，再命令行执行node index.js开启后端服务

在上传文件之前需要在server/server目录下新建static文件夹，然后在static文件夹里面新建两个文件夹，分别为file 和 temporary
