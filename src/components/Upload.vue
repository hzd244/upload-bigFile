<template>
  <div class="upload-container">
    <div class="wrap">
      <input type="file" @change="openFile" class="ipt" />
      <span style="font-size: 12px; color: #666">文件大小为：{{ fileSize }}</span>
      <el-progress :percentage="hashPercentage" :format="format"></el-progress>
      <el-progress
        v-if="!uploaded"
        :percentage="totalPercentage > 100 ? 100 : totalPercentage"
        :format="format"
      ></el-progress>
      <span v-else style="display: block; font-size: 15px; color: #999; text-align: center">文件上传成功</span>
      <div class="btn">
        <el-button type="primary" size="small" @click="uploadFile" :disabled="disabled">上传</el-button>
        <el-button type="warning" size="small" @click="handlePause">{{ upload ? '暂停' : '继续' }}</el-button>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
const SIZE = 5 * 1024 * 1024
const CancelToken = axios.CancelToken
let source = CancelToken.source()

export default {
  name: 'UploadUpload',
  data() {
    return {
      file: null, // 选择的文件
      fileChunks: [], // 切片数组
      worker: null,
      hash: null, // 所上传图片的hash值
      verifyData: null, // 后端校验返回的数据
      disabled: false, // 按钮是否禁用
      upload: true,
      hashPercentage: 0, // 计算hash值的进度条
      uploaded: false,
      totalPercentage: 0, // 文件上传的进度条
      uploadedList: [], // 已上传的切片列表
    }
  },
  methods: {
    // 格式化百分比
    format(percentage) {
      return percentage === 100 ? '已完成' : `${percentage}%`
    },
    // 打开文件
    openFile(e) {
      this.file = e.target.files[0]
    },
    // 上传文件切片
    async uploadFileChunks(list) {
      if (list.length === 0) {
        await axios({
          method: 'get',
          url: 'http://localhost:3000/merge',
          params: {
            filename: this.file.name,
            hash: this.hash,
          },
        })
        console.log('上传完成')
        this.totalPercentage = 100
        return
      }
      let pool = [] //并发池
      let max = 3 //最大并发量
      let finish = 0 //完成的数量
      let failList = [] //失败的列表
      for (let i = 0; i < list.length; i++) {
        let item = list[i]
        let formData = new FormData()
        formData.append('filename', this.file.name)
        formData.append('hash', item.hash)
        formData.append('chunk', item.chunk)
        formData.append('fileHash', this.hash)
        let task = axios({
          method: 'post',
          url: 'http://localhost:3000/upload',
          data: formData,
          onUploadProgress: this.createProgressHandler(item),
          cancelToken: source.token, // 添加 cancelToken，用于后续取消请求发送
        })
        task
          .then(res => {
            console.log(res)
            let j = pool.findIndex(t => t === task)
            pool.splice(j)
          })
          .catch(err => {
            console.log(err)
            failList.push(item)
          })
          .finally(() => {
            finish++
            if (finish === list.length) {
              this.uploadFileChunks(failList)
            }
          })
        pool.push(task)
        if (pool.length === max) {
          //每当并发池跑完一个任务，就再塞入一个任务
          await Promise.race(pool)
        }
      }
    },
    // 创建切片数组
    createFileChunk(file, size = SIZE) {
      const fileChunkList = []
      let cur = 0
      while (cur < file.size) {
        fileChunkList.push({
          file: file.slice(cur, cur + size),
        })
        cur += size
      }
      return fileChunkList
    },
    // 上传文件
    async uploadFile() {
      if (!this.file) return
      const fileChunkList = this.createFileChunk(this.file)
      let samplingList = this.sampling(this.file)

      // 计算抽样hash
      console.time()
      this.hash = await this.calculateHash(samplingList)
      console.timeEnd()
      console.log(this.hash)

      // 计算全量hash
      // console.time()
      // this.hash = await this.calculateHash(fileChunkList)
      // console.timeEnd()
      // console.log(this.hash)

      await this.verifyUpload(this.file.name, this.hash)
      if (!this.verifyData.shouldUpload) {
        this.uploaded = true
        console.log('上传完成')
        return
      }
      this.fileChunks = fileChunkList.map(({ file }, index) => ({
        chunk: file,
        hash: this.hash + '-' + index,
        percentage: 0,
      }))
      this.uploadFileChunks(this.fileChunks)
    },
    // 暂停上传
    async handlePause() {
      this.upload = !this.upload
      if (!this.upload) {
        source.cancel('终止上传！')
        source = CancelToken.source()
      } else {
        await this.getUploaded(this.hash)
        this.uploadFileChunks(this.uploadedList)
      }
    },
    // 生成hash
    calculateHash(fileChunkList) {
      return new Promise(resolve => {
        // 添加 worker 属性
        this.worker = new Worker('/hash.js')
        this.worker.postMessage({ fileChunkList })
        this.worker.onmessage = e => {
          const { hash, percentage } = e.data
          this.hashPercentage = parseInt(percentage.toFixed(2))
          if (hash) {
            resolve(hash)
          }
        }
      })
    },
    // 抽样
    sampling(file) {
      const OFFSET = Math.floor(2 * 1024 * 1024) // 取样范围 2M
      let index = OFFSET
      // 头尾全取，中间抽2字节
      const chunks = [{ file: file.slice(0, index) }]
      while (index < file.size) {
        if (index + OFFSET > file.size) {
          chunks.push({ file: file.slice(index) })
        } else {
          const CHUNK_OFFSET = 2
          chunks.push(
            { file: file.slice(index, index + 2) },
            { file: file.slice(index + OFFSET - CHUNK_OFFSET, index + OFFSET) },
          )
        }
        index += OFFSET
      }
      return chunks
    },
    // 校验文件是否已存在
    async verifyUpload(fileName, fileHash) {
      await axios({
        method: 'get',
        url: 'http://localhost:3000/verify',
        params: {
          filename: fileName,
          hash: fileHash,
        },
      }).then(res => {
        this.verifyData = res.data
      })
    },
    // 获取已上传成功的切片列表
    async getUploaded(fileHash) {
      await axios({
        method: 'get',
        url: 'http://localhost:3000/getUploaded',
        params: {
          hash: fileHash,
        },
      }).then(res => {
        if (res.data.code === 2) {
          const arr = res.data.uploaded
          let list = []
          for (let i = 0; i < this.fileChunks.length; i++) {
            if (arr.indexOf(this.fileChunks[i].hash) === -1) {
              list.push(this.fileChunks[i])
            }
          }
          this.uploadedList = list
        }
      })
    },
    createProgressHandler(item) {
      return e => {
        item.percentage = parseInt(String((e.loaded / e.total) * 100))
      }
    },
  },
  computed: {
    // 文件大小
    fileSize() {
      if (this.file === null) {
        return ''
      } else {
        if (this.file.size > 100 * 1024 * 1024) {
          return (this.file.size / 1024 / 1024 / 1000).toFixed(2) + 'G'
        }
        return (this.file.size / 1024 / 1024).toFixed(2) + 'M'
      }
    },
    totalPercent() {
      if (this.fileChunks.length === 0) return 0
      const loaded = this.fileChunks.map(item => item.chunk.size * item.percentage).reduce((acc, cur) => acc + cur)
      return parseInt((loaded / this.file.size).toFixed(2))
    },
  },
  watch: {
    totalPercent(oldVal, newVal) {
      this.totalPercentage = newVal
    },
  },
}
</script>

<style lang="css">
.upload-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 400px;
  height: 200px;
  margin: 100px;
  border: 1px #666 solid;
}
.wrap {
  width: 80%;
  height: 80%;
}
.ipt {
  margin-bottom: 10px;
  width: 100%;
}
.btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 265px;
  height: 60px;
}
</style>
