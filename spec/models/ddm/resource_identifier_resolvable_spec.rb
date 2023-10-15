require 'spec_helper'

RSpec.describe Ddm::ResourceIdentifierResolvable do
  let(:klass) {
    Class.new do
      include ActiveModel::Model
      include Ddm::ResourceIdentifierResolvable
      attr_accessor :payload
    end
  }

  it 'should collect required resource identifiers' do
    instance = klass.new(payload: {
      'Echo' => 'test',
      'AssetReference' => '@asset/test1',
      'AssetReferenceDeep' => {
        '@asset/test123' => 'test',
        'Deep' => [
          { key: '@asset/test12' },
        ],
      },

    })

    required = instance.collect_required_resource_identifiers_from(['@asset/test', '@asset/test1', '@asset/test12', '@asset/test123'])
    expect(required).to contain_exactly('@asset/test1', '@asset/test12')

    required = instance.collect_required_resource_identifiers_from(['@asset/test'])
    expect(required).to be_empty
  end

  it 'should resolve public assets references' do
    instance = klass.new(payload: {
      'ProfileURL' => '@public/test1',
      '@public/test' => 'test',
      'test' => '123@public/test12',
      'Deep' => [
        { key: '@public/test12' },
      ],
    })

    public_asset_url_map = {
      '@public/test1' => 'https://example.com/test1',
      '@public/test12' => 'https://example.com/test12',
      '@public/test123' => 'https://example.com/test123',
    }

    expect(instance.reference_identifier_resolved_payload(public_asset_url_map)).to eq({
      'ProfileURL' => 'https://example.com/test1',
      '@public/test' => 'test',
      'test' => '123@public/test12',
      'Deep' => [
        { key: 'https://example.com/test12' },
      ],
    })

    public_asset_url_map = {
      '@public/test1' => 'https://example.com/test1',
    }

    expect { instance.reference_identifier_resolved_payload(public_asset_url_map) }.
      to raise_error(Ddm::ResourceIdentifierResolvable::InsufficientResourceIdentifiers, /\[@public\/test12\]/)
  end
end
