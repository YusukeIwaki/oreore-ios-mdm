require 'spec_helper'

describe 'POST /ddm/activations', logged_in: true do
  before {
    Ddm::ActivationTarget.delete_all
    Ddm::Activation.delete_all
  }

  it 'should create a new activation' do
    post '/ddm/activations', {
      name: 'apply_test1_for_ipad',
      type: 'com.apple.activation.hoge', # not used
      payload: <<~YAML,
      ---
      Predicate: "(@status(device.model.family) == 'iPad')"
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: ""
    }

    activation = Ddm::Activation.find_by!(name: 'apply_test1_for_ipad')
    expect(activation.type).to eq('com.apple.activation.simple')
    expect(activation.payload.keys).to contain_exactly('Predicate', 'StandardConfigurations')
    expect(activation.payload['Predicate']).to eq("(@status(device.model.family) == 'iPad')")
    expect(activation.payload['StandardConfigurations']).to contain_exactly('@configuration/test1')
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.first.target_identifier).to be_nil
  end

  it 'should create a new activation even if type if not given' do
    post '/ddm/activations', {
      name: 'apply_test1_for_ipad',
      payload: <<~YAML,
      ---
      Predicate: "(@status(device.model.family) == 'iPad')"
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: ""
    }

    activation = Ddm::Activation.find_by!(name: 'apply_test1_for_ipad')
    expect(activation.type).to eq('com.apple.activation.simple')
    expect(activation.payload.keys).to contain_exactly('Predicate', 'StandardConfigurations')
    expect(activation.payload['Predicate']).to eq("(@status(device.model.family) == 'iPad')")
    expect(activation.payload['StandardConfigurations']).to contain_exactly('@configuration/test1')
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.first.target_identifier).to be_nil
  end

  it 'should create a new activation with specified target identifiers' do
    post '/ddm/activations', {
      name: 'apply_test1_for_ipad',
      type: 'com.apple.activation.simple',
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: <<~CSV
      SERIAL1
      SERIAL2

      group1
      CSV
    }

    activation = Ddm::Activation.find_by!(name: 'apply_test1_for_ipad')
    expect(activation.type).to eq('com.apple.activation.simple')
    expect(activation.targets.count).to eq(3)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL1', 'SERIAL2', 'group1')
  end

  it 'should raise error if name is not given' do
    expect {
      post '/ddm/activations', {
        payload: <<~YAML,
        ---
        Predicate: "(@status(device.model.family) == 'iPad')"
        StandardConfigurations:
        - "@configuration/test1"
        YAML
      }
    }.to raise_error
    expect(Ddm::Activation.count).to eq(0)
  end

  it 'should raise error if payload is blank' do
    expect {
      post '/ddm/activations', {
        name: 'apply_test1_for_ipad',
        payload: "",
        target_identifiers: "",
      }
    }.to raise_error
    expect(Ddm::Activation.count).to eq(0)
  end

  it 'should ignore duplicated entry' do
    post '/ddm/activations', {
      name: 'apply_test1_for_ipad',
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: <<~CSV
      SERIAL1
      SERIAL1
      CSV
    }

    activation = Ddm::Activation.find_by!(name: 'apply_test1_for_ipad')
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL1')
  end
end

describe 'POST /ddm/activations/:id', logged_in: true do
  before {
    Ddm::ActivationTarget.delete_all
    Ddm::Activation.delete_all
  }

  it 'should update an activation' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )

    post "/ddm/activations/#{activation.id}", {
      name: 'apply_test1_for_ipad', # not used
      type: 'com.apple.activation.fuga', # not used
      payload: <<~YAML,
      ---
      Predicate: "(@status(device.model.family) == 'iPad')"
      StandardConfigurations:
      - "@configuration/test2"
      YAML
      target_identifiers: ""
    }
    activation.reload
    expect(activation.name).to eq('apply_test1') # not updated even if name is given
    expect(activation.type).to eq('com.apple.activation.simple') # not updated even if type is given
    expect(activation.payload.keys).to contain_exactly('Predicate', 'StandardConfigurations')
    expect(activation.payload['Predicate']).to eq("(@status(device.model.family) == 'iPad')")
    expect(activation.payload['StandardConfigurations']).to contain_exactly('@configuration/test2')
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.first.target_identifier).to be_nil
  end

  it 'should update target identifiers' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    activation.targets.create!(target_identifier: 'SERIAL1')

    post "/ddm/activations/#{activation.id}", {
      name: 'apply_test1_for_ipad', # not used
      type: 'com.apple.activation.simple', # not used
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: <<~CSV
      SERIAL2
      SERIAL3

      group1
      CSV
    }
    activation.reload
    expect(activation.targets.count).to eq(3)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL2', 'SERIAL3', 'group1')
  end

  it 'should update target to nil' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    original_updated_at = activation.updated_at
    original_target = activation.targets.create!(target_identifier: 'SERIAL1')

    post "/ddm/activations/#{activation.id}", {
      name: 'apply_test1_for_ipad', # not used
      type: 'com.apple.activation.simple', # not used
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: ""
    }
    activation.reload
    expect(activation.updated_at).to eq(original_updated_at)
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.first.target_identifier).to be_nil
    expect { original_target.reload }.to raise_error(ActiveRecord::RecordNotFound)
  end

  it 'should keep original record if target is not changed (nil)' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    target = activation.targets.create!(target_identifier: nil)
    original_updated_at = activation.updated_at
    original_target_id = target.id

    post "/ddm/activations/#{activation.id}", {
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: "\n"
    }
    activation.reload
    expect(activation.updated_at).to eq(original_updated_at)
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.first.target_identifier).to be_nil
    expect(activation.targets.first.id).to eq(original_target_id)
  end

  it 'should add target from nil' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    original_target = activation.targets.create!(target_identifier: nil)

    post "/ddm/activations/#{activation.id}", {
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: <<~CSV
      SERIAL1
      SERIAL2
      CSV
    }
    activation.reload
    expect(activation.targets.count).to eq(2)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL1', 'SERIAL2')
    expect { original_target.reload }.to raise_error(ActiveRecord::RecordNotFound)
  end

  it 'should keep original record if target is added' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    original_target = activation.targets.create!(target_identifier: 'SERIAL1')

    post "/ddm/activations/#{activation.id}", {
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: <<~CSV
      SERIAL1
      SERIAL2
      CSV
    }
    activation.reload
    expect(activation.targets.count).to eq(2)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL1', 'SERIAL2')
    expect(activation.target_ids).to include(original_target.id)
  end

  it 'should keep original record if target is removed' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    original_target1 = activation.targets.create!(target_identifier: 'SERIAL1')
    original_target2 = activation.targets.create!(target_identifier: 'SERIAL2')

    post "/ddm/activations/#{activation.id}", {
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: "SERIAL1"
    }
    activation.reload
    expect(activation.targets.count).to eq(1)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL1')
    expect(activation.target_ids).to contain_exactly(original_target1.id)
    expect { original_target2.reload }.to raise_error(ActiveRecord::RecordNotFound)
  end

  it 'should raise error if payload is blank' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    expect {
      post "/ddm/activations/#{activation.id}", {
        payload: "",
        target_identifiers: "",
      }
    }.to raise_error
    expect(activation.reload.payload).to eq('StandardConfigurations' => ['@configuration/test1'])
  end

  it 'should raise error if target is duplicated' do
    activation = Ddm::Activation.create!(
      name: 'apply_test1',
      type: 'com.apple.activation.simple',
      payload: { 'StandardConfigurations' => ['@configuration/test1'] },
    )
    target = activation.targets.create!(target_identifier: 'SERIAL1')

    post "/ddm/activations/#{activation.id}", {
      payload: <<~YAML,
      ---
      StandardConfigurations:
      - "@configuration/test1"
      YAML
      target_identifiers: <<~CSV
      SERIAL2
      SERIAL2
      CSV
    }
    expect(activation.reload.targets.count).to eq(1)
    expect(activation.targets.pluck(:target_identifier)).to contain_exactly('SERIAL2')
  end
end
