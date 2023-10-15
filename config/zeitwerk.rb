loader = Zeitwerk::Loader.new
loader.push_dir('./lib')
loader.push_dir('./models')
loader.push_dir('./uploaders')
loader.setup
