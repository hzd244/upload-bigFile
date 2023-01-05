const express = require('express')
const multiparty = require('multiparty')
const fs = require('fs')
const path = require('path')
const { Buffer } = require('buffer')
const fse = require("fs-extra")

// 上传文件最终路径
const STATIC_FILES = path.join(__dirname, './static/files')
// 上传文件临时路径
const STATIC_TEMPORARY = path.join(__dirname, './static/temporary')

 // 提取后缀名
const extractExt = filename => filename.slice(filename.lastIndexOf("."), filename.length)

const server = express()

const cors = require('cors')
server.use(cors())
// 静态文件托管
server.use(express.static(path.join(__dirname, './dist')))
// 切片上传的接口
server.post('/upload', (req, res) => {
  const form = new multiparty.Form()
  form.parse(req, function (err, fields, files) {
	  if (err) {
            console.log('文件切片上传失败:', err);
            res.send({
                code: 0,
                message: '文件切片上传失败'
            });
            return;
        }
    try {
		let filename = fields.filename[0]
		let hash = fields.hash[0]
		let chunk = files.chunk[0]
		let fileHash = fields.fileHash[0]
		let dir = `${STATIC_TEMPORARY}/chunkDir_${fileHash}`
      if (!fs.existsSync(dir)) fs.mkdirSync(dir)
      const buffer = fs.readFileSync(chunk.path)
      const ws = fs.createWriteStream(`${dir}/${hash}`)
      ws.write(buffer)
      ws.close()
	  res.send({
		  code: 200,
		  message: `${filename}-${hash} 切片上传成功`
	  })
    } catch (error) {
      console.error(error)
	  res.send({
		  code: 500,
		  message: `${filename}-${hash} 切片上传失败`
	  })
    }
  })
})
//合并切片接口
server.get('/merge', async (req, res) => {
  const { filename, hash } = req.query
  const ext = extractExt(filename)
  try {
    let len = 0
    const bufferList = fs.readdirSync(`${STATIC_TEMPORARY}/chunkDir_${hash}`).map((item,index) => {
      const buffer = fs.readFileSync(`${STATIC_TEMPORARY}/chunkDir_${hash}/${hash}-${index}`)
      len += buffer.length
      return buffer
    })
    //合并文件
    const buffer = Buffer.concat(bufferList, len)
    const ws = fs.createWriteStream(`${STATIC_FILES}/${hash}${ext}`)
    ws.write(buffer)
    ws.close()
    res.send(`切片合并完成`)
  } catch (error) {
    console.error(error)
  }
})

// 校验切片
server.get('/verify', async (req, res) => {
	const { filename, hash } = req.query
	const ext = extractExt(filename)
	let dir = `${STATIC_FILES}/${hash}${ext}`
	try {
		if (fs.existsSync(dir)) {
			res.send({shouldUpload: false})
		} else {
			res.send({shouldUpload: true})
		}
	}catch (error) {
      console.error(error)
      res.status(500).send(`校验失败`)
    }
})

// 获取已上传成功的切片列表
server.get('/getUploaded', async (req, res) => {
	const { hash } = req.query
	let dir = `${STATIC_TEMPORARY}/chunkDir_${hash}`
	try {
		if (fs.existsSync(dir)) {
			// 目录存在，则说明文件之前有上传过一部分，但是没有完整上传成功
			// 读取之前已上传的所有切片文件名
			const uploaded = await fse.readdir(dir)
			res.send({
				code: 2,
				message: '该文件有部分上传数据',
				uploaded
			})
		} else {
			res.send({
				code: 0
			})
		}
	}catch (error) {
      console.error(error)
      res.status(500).send(`获取失败`)
    }
})

server.listen(3000, _ => {
  console.log('http://localhost:3000/')
})
